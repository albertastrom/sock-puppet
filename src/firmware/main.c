// Three-servo slave for the Arduino UNO Q (sketch runs on the STM32U585).
//
// The master sends commands of the form  <motor>,<direction>,<angle>[,<speed>]
//   1,+,180       motor 1, positive direction, 180 degrees
//   2,-,30        motor 2, negative direction, 30 degrees
//   3,+,90,45     motor 3, positive, 90 degrees, at 45 degrees per second
//   1,=,120,45    motor 1, immediately retarget to absolute servo angle 120
// The speed term is optional (DEFAULT_SPEED when left off), capped at SPEED_LIMIT.
// Commands are separated by a newline or a space, so a whole block can be
// pasted at once:  1,-,40 2,+,30 3,+,60   (no spaces inside a command)
// +/- angles are relative moves. Commands for the same motor are queued and play
// in order, each easing in and out and finishing before the next one starts, so
// 1,+,20 sent twice moves 20 and then 20 more. '=' is an absolute, immediate
// retarget for real-time controllers; it clears that motor's relative queue.
// Different motors move at the same time, and nothing blocks (see QUEUE_MOVES to
// add relative commands up instead).
// Malformed commands get an "ERR ..." reply on the port they came from.

#include <Arduino_HardwareServo.h>
#include <math.h>

// ---- S-curve motion for one servo ----
//
// Stage 1 (planner): a trapezoidal velocity profile chases `target`, limited to
// vmax (deg/s) and amax (deg/s^2). It copes with the target moving mid-flight:
// new commands, reversals and clamping all just change the error it chases.
//
// Stage 2 (smoothing): the output is the planner position run through two moving
// averages in a row, each over `smoothTicks` ticks. That rounds the trapezoid's
// corners into a bell-shaped speed curve: a long, gentle start, a quick middle,
// and a long, gentle end. Two passes exaggerate the shape more than one, and
// longer windows exaggerate it further. The output settles exactly on the target.
class SCurveMotor {
 public:
  static const int MAX_SMOOTH_TICKS = 64;

  void begin(float home, float lo, float hi, float accelTime, int smoothTicks) {
    lo_ = lo;
    hi_ = hi;
    accelTime_ = accelTime;
    n_ = smoothTicks < 1 ? 1 : (smoothTicks > MAX_SMOOTH_TICKS ? MAX_SMOOTH_TICKS : smoothTicks);
    target_ = plan_ = out_ = home;
    vel_ = 0;
    idx_ = 0;
    for (int i = 0; i < n_; i++) hist_[i] = hist2_[i] = home;
  }

  // Relative move at up to `speed` deg/s (must be > 0). Acceleration scales with
  // speed so every move takes the same accelTime to reach full speed, which keeps
  // the ease in/out consistent. Accumulates on the current target, clamped to
  // [lo, hi].
  void moveBy(float deg, float speed) {
    moveTo(target_ + deg, speed);
  }

  // Retarget immediately to an absolute servo angle.
  void moveTo(float deg, float speed) {
    vmax_ = speed;
    amax_ = speed / accelTime_;
    target_ = deg;
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

    // Two moving averages in series: planner -> first average -> second average.
    hist_[idx_] = plan_;
    float sum = 0;
    for (int i = 0; i < n_; i++) sum += hist_[i];
    hist2_[idx_] = sum / n_;
    idx_ = (idx_ + 1) % n_;
    sum = 0;
    for (int i = 0; i < n_; i++) sum += hist2_[i];
    out_ = sum / n_;
    if (out_ < lo_) out_ = lo_;
    if (out_ > hi_) out_ = hi_;
  }

  // Position to send to the servo, rounded to a whole degree.
  int angle() const { return (int)(out_ + 0.5f); }

  // True once the last move has finished: planner at rest on the target and the
  // smoothed output within half a step of it, i.e. the servo is already sitting on
  // its final whole degree. (The output keeps converging on the exact target.)
  bool settled() const {
    return plan_ == target_ && vel_ == 0 && fabsf(out_ - target_) < 0.5f;
  }

 private:
  float lo_ = 0, hi_ = 180, vmax_ = 100, amax_ = 300, accelTime_ = 0.3f;
  float target_ = 0, plan_ = 0, vel_ = 0, out_ = 0;
  float hist_[MAX_SMOOTH_TICKS];   // Planner position history (first average)
  float hist2_[MAX_SMOOTH_TICKS];  // First average's history (second average)
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

static const float DEFAULT_SPEED = 120;  // deg/s, used when a command has no speed term
static const float SPEED_LIMIT = 300;    // deg/s, fastest a command may ask for
static const float ACCEL_TIME_S = 0.3;   // Seconds to reach full speed; longer = gentler ease in/out
static const uint32_t SMOOTH_MS = 200;   // Per smoothing pass (max 320). Longer = slower start/end, more exaggerated S
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
static const uint16_t QUEUE_DEPTH = 256;  // Per motor; about 1 KB each
struct MoveQueue {
  int16_t delta[QUEUE_DEPTH];
  uint16_t speed[QUEUE_DEPTH];
  uint16_t head = 0;
  uint16_t count = 0;
};
MoveQueue queues[NUM_MOTORS];

// ---- Command parsing ----
// Returns NULL on success, otherwise an error message.
static const char *applyCommand(const char *p) {
  if (*p < '1' || *p > '0' + NUM_MOTORS) return "ERR motor";
  int motor = *p++ - '1';

  if (*p++ != ',') return "ERR format";
  char dir = *p++;
  if (dir != '+' && dir != '-' && dir != '=') return "ERR direction";

  if (*p++ != ',') return "ERR format";
  if (*p < '0' || *p > '9') return "ERR angle";
  int angle = 0;
  while (*p >= '0' && *p <= '9') {
    if (angle < 1000) angle = angle * 10 + (*p - '0');
    p++;
  }

  // Optional 4th term: speed in degrees per second.
  int speed = (int)DEFAULT_SPEED;
  if (*p == ',') {
    p++;
    if (*p < '0' || *p > '9') return "ERR speed";
    speed = 0;
    while (*p >= '0' && *p <= '9') {
      if (speed < 1000) speed = speed * 10 + (*p - '0');
      p++;
    }
    if (speed < 1) return "ERR speed";
    if (speed > (int)SPEED_LIMIT) speed = (int)SPEED_LIMIT;
  }
  if (*p != '\0') return "ERR format";

  int delta = dir == '+' ? angle : -angle;
#if QUEUE_MOVES
  MoveQueue &q = queues[motor];
  if (dir == '=') {
    q.head = 0;
    q.count = 0;
    motors[motor].moveTo((float)angle, (float)speed);
    return NULL;
  }
  if (q.count >= QUEUE_DEPTH) return "ERR queue full";
  uint16_t slot = (q.head + q.count) % QUEUE_DEPTH;
  q.delta[slot] = (int16_t)delta;
  q.speed[slot] = (uint16_t)speed;
  q.count++;
#else
  if (dir == '=') motors[motor].moveTo((float)angle, (float)speed);
  else motors[motor].moveBy((float)delta, (float)speed);
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
    motors[i].begin(HOME_DEG, MIN_DEG, MAX_DEG, ACCEL_TIME_S, smoothTicks);
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
        motors[i].moveBy((float)q.delta[q.head], (float)q.speed[q.head]);
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
