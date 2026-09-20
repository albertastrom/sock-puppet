// Three-servo slave for the Arduino UNO Q (sketch runs on the STM32U585).
//
// The master sends commands of the form  <motor>,<direction>,<angle>
//   1,+,180    motor 1, positive direction, 180 degrees
//   2,-,30     motor 2, negative direction, 30 degrees
// Commands are separated by a newline or a space, so a whole block can be
// pasted at once:  1,-,40 2,+,30 3,+,60   (no spaces inside a command)
// Angles are relative moves. Commands for the same motor are queued and play in
// order, each easing in and out and finishing before the next one starts, so
// 1,+,20 sent twice moves 20 and then 20 more. Different motors move at the same
// time, and nothing blocks (see QUEUE_MOVES to add commands up instead).
// Malformed commands get an "ERR ..." reply on the port they came from.

#include <Arduino_HardwareServo.h>
#include <math.h>

// ---- S-curve motion for one servo ----
//
// Stage 1 (planner): a trapezoidal velocity profile chases `target`, limited to
// vmax (deg/s) and amax (deg/s^2). It copes with the target moving mid-flight:
// new commands, reversals and clamping all just change the error it chases.
//
// Stage 2 (smoothing): the output is a moving average of the planner position
// over `smoothTicks` ticks. That rounds the trapezoid's corners, so acceleration
// ramps up and down instead of switching, giving the S-curve: ease in, fast in
// the middle, ease out. The average settles exactly on the target.
class SCurveMotor {
 public:
  static const int MAX_SMOOTH_TICKS = 64;

  void begin(float home, float lo, float hi, float vmax, float amax,
             int smoothTicks) {
    lo_ = lo;
    hi_ = hi;
    vmax_ = vmax;
    amax_ = amax;
    n_ = smoothTicks < 1 ? 1 : (smoothTicks > MAX_SMOOTH_TICKS ? MAX_SMOOTH_TICKS : smoothTicks);
    target_ = plan_ = out_ = home;
    vel_ = 0;
    idx_ = 0;
    for (int i = 0; i < n_; i++) hist_[i] = home;
  }

  // Relative move. Accumulates on the current target, clamped to [lo, hi].
  void moveBy(float deg) {
    target_ += deg;
    if (target_ < lo_) target_ = lo_;
    if (target_ > hi_) target_ = hi_;
  }

  // Advance by dt seconds. Call at a fixed rate.
  void tick(float dt) {
    float e = target_ - plan_;

    // Speed we may have here: capped at vmax, and low enough to brake to a stop
    // on the target. Discounting one tick of travel stops the discrete-time
    // braking curve from arriving late.
    float vDes = 0;
    if (e != 0) {
      float room = fabsf(e) - fabsf(vel_) * dt;
      if (room < 0) room = 0;
      float m = sqrtf(2.0f * amax_ * room);
      if (m > vmax_) m = vmax_;
      vDes = e > 0 ? m : -m;
    }

    float lim = amax_ * dt;
    float dv = vDes - vel_;
    if (dv > lim) dv = lim;
    if (dv < -lim) dv = -lim;
    vel_ += dv;
    plan_ += vel_ * dt;

    // Crossed the target, or effectively there and nearly stopped: land on it.
    float e2 = target_ - plan_;
    if (e * e2 < 0 || (fabsf(e2) < 0.01f && fabsf(vel_) < 2.0f * lim)) {
      plan_ = target_;
      vel_ = 0;
    }

    hist_[idx_] = plan_;
    idx_ = (idx_ + 1) % n_;
    float sum = 0;
    for (int i = 0; i < n_; i++) sum += hist_[i];
    out_ = sum / n_;
    if (out_ < lo_) out_ = lo_;
    if (out_ > hi_) out_ = hi_;
  }

  // Position to send to the servo, rounded to a whole degree.
  int angle() const { return (int)(out_ + 0.5f); }

  // True once the last move has fully finished: planner at rest on the target
  // and the smoothed output has caught up (within a tenth of a step).
  bool settled() const {
    return plan_ == target_ && vel_ == 0 && fabsf(out_ - target_) < 0.05f;
  }

 private:
  float lo_ = 0, hi_ = 180, vmax_ = 100, amax_ = 300;
  float target_ = 0, plan_ = 0, vel_ = 0, out_ = 0;
  float hist_[MAX_SMOOTH_TICKS];
  int n_ = 1, idx_ = 0;
};

// ---- Configuration ----
#define NUM_MOTORS 3
static const uint8_t SERVO_PINS[NUM_MOTORS] = {9, 10, 6};  // Motors 1, 2, 3 (PWM-marked pins)
static const long BAUD = 115200;

#define ACCEPT_ON_SERIAL 1  // Also accept commands on Serial (Monitor / App Lab serial monitor)
#define REPLY_OK 1          // Answer every accepted command with "OK" and print READY at boot
#define QUEUE_MOVES 1       // 1: a motor's commands play one after another, each finishing before the next.
                            // 0: commands add up and the motor heads straight for the running total.

static const float HOME_DEG = 90;    // Where every servo is put at power-up
static const float MIN_DEG = 0;
static const float MAX_DEG = 180;

static const float MAX_SPEED = 120;      // deg/s
static const float MAX_ACCEL = 400;      // deg/s^2
static const uint32_t SMOOTH_MS = 120;   // Longer = softer S-curve, slower to settle
static const uint32_t TICK_US = 5000;    // Motion update rate (200 Hz)

// ---- State ----
HardwareServo servos[NUM_MOTORS];
SCurveMotor motors[NUM_MOTORS];
int lastWritten[NUM_MOTORS];
uint32_t lastTick;

static const uint8_t CMD_LINE_MAX = 32;
struct LineBuffer {
  char text[CMD_LINE_MAX];
  uint8_t len = 0;
  bool overflow = false;
};
LineBuffer serial1Line;
#if ACCEPT_ON_SERIAL
LineBuffer serialLine;
#endif

// Pending relative moves for one motor (ring buffer).
static const uint8_t QUEUE_DEPTH = 32;
struct MoveQueue {
  int16_t delta[QUEUE_DEPTH];
  uint8_t head = 0;
  uint8_t count = 0;
};
MoveQueue queues[NUM_MOTORS];

// ---- Command parsing ----
// Returns NULL on success, otherwise an error message.
static const char *applyCommand(const char *p) {
  if (*p < '1' || *p > '0' + NUM_MOTORS) return "ERR motor";
  int motor = *p++ - '1';

  if (*p++ != ',') return "ERR format";
  char dir = *p++;
  if (dir != '+' && dir != '-') return "ERR direction";

  if (*p++ != ',') return "ERR format";
  if (*p < '0' || *p > '9') return "ERR angle";
  int angle = 0;
  while (*p >= '0' && *p <= '9') {
    if (angle < 1000) angle = angle * 10 + (*p - '0');
    p++;
  }
  if (*p != '\0') return "ERR format";

  int delta = dir == '+' ? angle : -angle;
#if QUEUE_MOVES
  MoveQueue &q = queues[motor];
  if (q.count >= QUEUE_DEPTH) return "ERR queue full";
  q.delta[(q.head + q.count) % QUEUE_DEPTH] = (int16_t)delta;
  q.count++;
#else
  motors[motor].moveBy((float)delta);
#endif
  return NULL;
}

// Feed one received byte. A newline, carriage return, space or tab ends the
// current command and runs it; empty commands are ignored. Returns a reply to
// send back ("ERR ..." if the command was bad, "OK" if accepted and REPLY_OK
// is on), or NULL when nothing needs saying.
static const char *feedByte(LineBuffer &line, char c) {
  if (c != '\n' && c != '\r' && c != ' ' && c != '\t') {
    if (line.len < CMD_LINE_MAX - 1) line.text[line.len++] = c;
    else line.overflow = true;
    return NULL;
  }
  const char *reply = NULL;
  if (line.overflow) {
    reply = "ERR too long";
  } else if (line.len > 0) {
    line.text[line.len] = '\0';
    reply = applyCommand(line.text);
#if REPLY_OK
    if (!reply) reply = "OK";
#endif
  }
  line.len = 0;
  line.overflow = false;
  return reply;
}

// ---- Arduino entry points ----
void setup() {
  Serial1.begin(BAUD);
#if ACCEPT_ON_SERIAL
  Serial.begin(BAUD);
#endif

  int smoothTicks = (int)(SMOOTH_MS * 1000UL / TICK_US);
  for (int i = 0; i < NUM_MOTORS; i++) {
    motors[i].begin(HOME_DEG, MIN_DEG, MAX_DEG, MAX_SPEED, MAX_ACCEL, smoothTicks);
    servos[i].attach(SERVO_PINS[i]);
    lastWritten[i] = motors[i].angle();
    servos[i].write(lastWritten[i]);
  }
  lastTick = micros();

#if REPLY_OK
  Serial1.println("READY");
#if ACCEPT_ON_SERIAL
  Serial.println("READY");
#endif
#endif
}

void loop() {
  while (Serial1.available() > 0) {
    const char *err = feedByte(serial1Line, (char)Serial1.read());
    if (err) Serial1.println(err);
  }
#if ACCEPT_ON_SERIAL
  while (Serial.available() > 0) {
    const char *err = feedByte(serialLine, (char)Serial.read());
    if (err) Serial.println(err);
  }
#endif

  uint32_t now = micros();
  if ((uint32_t)(now - lastTick) >= TICK_US) {
    lastTick += TICK_US;
    if ((uint32_t)(now - lastTick) >= 4 * TICK_US) lastTick = now;  // fell behind: resync, don't burst

    const float dt = TICK_US / 1e6f;
    for (int i = 0; i < NUM_MOTORS; i++) {
#if QUEUE_MOVES
      // Start the next queued move once the previous one has fully finished.
      // A move that changes nothing (already at a limit) is skipped in the same pass.
      MoveQueue &q = queues[i];
      while (q.count > 0 && motors[i].settled()) {
        motors[i].moveBy((float)q.delta[q.head]);
        q.head = (q.head + 1) % QUEUE_DEPTH;
        q.count--;
      }
#endif
      motors[i].tick(dt);
      int a = motors[i].angle();
      if (a != lastWritten[i]) {
        servos[i].write(a);
        lastWritten[i] = a;
      }
    }
  }
}
