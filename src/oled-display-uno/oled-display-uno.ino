#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <string.h>
#include "logo.h"

// Arduino UNO Q. The sketch runs on the STM32U585, whose Zephyr overlay hands
// the Arduino core three I2C controllers, so each eye gets a bus of its own and
// both panels can keep the stock 0x3C address - no address jumper needed.
//
//   Wire  -> i2c2  SDA D20/PB11, SCL D21/PB10   left eye  (UNO header SDA/SCL)
//   Wire1 -> i2c4  Qwiic connector              unused
//   Wire2 -> i2c3  SDA D18/PC1,  SCL D19/PC0    right eye (a.k.a. A4/A5)
//
// Pin muxing comes from the devicetree, not from begin(), so picking the bus is
// the only wiring decision in the code.
//
// D18/D19 are also A4/A5. That is just the pin mux - I2C3 drives them as an
// ordinary open-drain digital bus, same as any other I2C. But it does mean they
// cannot be ADC inputs while the right eye is live: analogRead(A4) or
// analogRead(A5) would remux the pins away and the right panel would go dark.
#define OLED_ADDR 0x3C
#define BUS_HZ 400000

enum Eye { left = 0, right = 1 };

// u8g2 only ships transports for Wire (_HW_I2C) and Wire1 (_2ND_HW_I2C), and
// the Wire1 one compiles to a stub unless the core defines
// WIRE_INTERFACES_COUNT - which the Zephyr core does not. This is u8g2's stock
// hardware-I2C callback with the bus passed in, so the right eye can reach
// Wire2 and both eyes go down the same code path.
static uint8_t eye_byte_cb(TwoWire &bus, u8x8_t *u8x8, uint8_t msg,
                           uint8_t arg_int, void *arg_ptr) {
  switch (msg) {
    case U8X8_MSG_BYTE_SEND:
      bus.write((const uint8_t *)arg_ptr, (size_t)arg_int);
      break;
    case U8X8_MSG_BYTE_INIT:
      if (u8x8->bus_clock == 0) {
        u8x8->bus_clock = u8x8->display_info->i2c_bus_clock_100kHz * 100000UL;
      }
      // Re-applies the bus's default pinctrl state, which also brings up the
      // controller when it is marked zephyr,deferred-init (i2c3 is).
      bus.begin();
      break;
    case U8X8_MSG_BYTE_SET_DC:
      break;
    case U8X8_MSG_BYTE_START_TRANSFER:
      bus.setClock(u8x8->bus_clock);
      bus.beginTransmission(u8x8_GetI2CAddress(u8x8) >> 1);
      break;
    case U8X8_MSG_BYTE_END_TRANSFER:
      bus.endTransmission();
      break;
    default:
      return 0;
  }
  return 1;
}

// u8x8_msg_cb is declared inside u8g2's extern "C" block, so these thunks get
// C linkage too - same as u8g2's own byte callbacks.
extern "C" uint8_t u8x8_byte_left_eye(u8x8_t *u8x8, uint8_t msg,
                                      uint8_t arg_int, void *arg_ptr) {
  return eye_byte_cb(Wire, u8x8, msg, arg_int, arg_ptr);
}

extern "C" uint8_t u8x8_byte_right_eye(u8x8_t *u8x8, uint8_t msg,
                                       uint8_t arg_int, void *arg_ptr) {
  return eye_byte_cb(Wire2, u8x8, msg, arg_int, arg_ptr);
}

// Same panel as the ESP build (full buffer, 1 KB each), but bound to whichever
// bus the callback talks to instead of a fixed Wire instance.
class EyeDisplay : public U8G2 {
 public:
  explicit EyeDisplay(u8x8_msg_cb byte_cb) : U8G2() {
    u8g2_Setup_sh1106_i2c_128x64_noname_f(&u8g2, U8G2_R0, byte_cb,
                                          u8x8_gpio_and_delay_arduino);
  }
};

static EyeDisplay left_eye(u8x8_byte_left_eye);
static EyeDisplay right_eye(u8x8_byte_right_eye);

// Draw one expression on one eye. `expression` is the asset name without the
// -left/-right suffix or the .bin extension, e.g. "angry" for angry-left.bin
// and angry-right.bin. Returns false (and says so on serial) if the name is
// not in logo.h, so a typo shows up instead of silently leaving a stale frame.
bool setEye(Eye eye, const char *expression) {
  for (size_t i = 0; i < EYE_PAIR_COUNT; i++) {
    if (strcmp(eye_pairs[i].name, expression) != 0) {
      continue;
    }

    EyeDisplay &display = (eye == left) ? left_eye : right_eye;
    const unsigned char *bits =
        (eye == left) ? eye_pairs[i].left : eye_pairs[i].right;

    display.clearBuffer();
    display.drawXBM(0, 0, EYE_WIDTH, EYE_HEIGHT, bits);
    display.sendBuffer();
    return true;
  }

  Serial.print("setEye: no expression named '");
  Serial.print(expression);
  Serial.println("'");
  return false;
}

static bool probe(TwoWire &bus, const char *label) {
  bus.beginTransmission(OLED_ADDR);
  bool ok = bus.endTransmission() == 0;
  Serial.print(label);
  Serial.print(" panel at 0x3C: ");
  Serial.println(ok ? "yes" : "NO");
  return ok;
}

void setup() {
  Serial.begin(115200);
  delay(200);

  Wire.begin();
  Wire.setClock(BUS_HZ);
  Wire2.begin();
  Wire2.setClock(BUS_HZ);

  probe(Wire, "left  (D20/D21)");
  probe(Wire2, "right (D18/D19)");

  left_eye.setI2CAddress(OLED_ADDR << 1);
  left_eye.begin();
  left_eye.setContrast(0x80);

  right_eye.setI2CAddress(OLED_ADDR << 1);
  right_eye.begin();
  right_eye.setContrast(0x80);

  setEye(left, "angry");
  setEye(right, "love");
}

void loop() {
}
