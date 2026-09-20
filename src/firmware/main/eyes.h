#pragma once

// Two SH1106 OLED eyes for the Arduino UNO Q, lifted from the standalone
// oled-display-uno sketch so main.ino can drive eyes and servos from one program
// include this header once (main.ino does) and call eyesBegin() from setup(),
// then setEye() whenever an eye should change.
//
// The sketch runs on the STM32U585, whose Zephyr overlay hands the Arduino core
// three I2C controllers, so each eye gets a bus of its own and both panels can
// keep the stock 0x3C address - no address jumper needed.
//
//   Wire  -> i2c2  SDA D20/PB11, SCL D21/PB10   right eye (UNO header SDA/SCL)
//   Wire1 -> i2c4  Qwiic connector              unused
//   Wire2 -> i2c3  SDA D18/PC1,  SCL D19/PC0    left eye  (a.k.a. A4/A5)
//
// Pin muxing comes from the devicetree, not from begin(), so picking the bus is
// the only wiring decision in the code. None of these pins collide with the
// servo pins (9, 10, 6).
//
// D18/D19 are also A4/A5. That is just the pin mux - I2C3 drives them as an
// ordinary open-drain digital bus, same as any other I2C. But it does mean they
// cannot be ADC inputs while the left eye is live: analogRead(A4) or
// analogRead(A5) would remux the pins away and the right panel would go dark.
//
// Drawing a frame ships a 1 KB buffer over the bus and blocks for roughly 20 ms
// at 400 kHz, so the motion loop skips a few ticks whenever an eye changes.
// Eyes are set by hand for debugging, so that pause is not in the way of a move.

#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <string.h>
#include "logo.h"

#define OLED_ADDR 0x3C
#define BUS_HZ 400000

// values match the serial command's eye index: eye,0,... is left
enum Eye { EYE_LEFT = 0, EYE_RIGHT = 1 };

// u8g2 only ships transports for Wire (_HW_I2C) and Wire1 (_2ND_HW_I2C), and
// the Wire1 one compiles to a stub unless the core defines
// WIRE_INTERFACES_COUNT - which the Zephyr core does not. This is u8g2's stock
// hardware-I2C callback with the bus passed in, so the left eye can reach
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
  return eye_byte_cb(Wire2, u8x8, msg, arg_int, arg_ptr);
}

extern "C" uint8_t u8x8_byte_right_eye(u8x8_t *u8x8, uint8_t msg,
                                       uint8_t arg_int, void *arg_ptr) {
  return eye_byte_cb(Wire, u8x8, msg, arg_int, arg_ptr);
}

// Full-buffer SH1106 (1 KB each), bound to whichever bus the callback talks to
// instead of a fixed Wire instance.
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
// and angry-right.bin. Returns false if the name is not in logo.h, so a typo
// is reported instead of silently leaving a stale frame.
static bool setEye(Eye eye, const char *expression) {
  for (size_t i = 0; i < EYE_PAIR_COUNT; i++) {
    if (strcmp(eye_pairs[i].name, expression) != 0) {
      continue;
    }

    EyeDisplay &display = (eye == EYE_LEFT) ? left_eye : right_eye;
    const unsigned char *bits =
        (eye == EYE_LEFT) ? eye_pairs[i].left : eye_pairs[i].right;

    display.clearBuffer();
    display.drawXBM(0, 0, EYE_WIDTH, EYE_HEIGHT, bits);
    display.sendBuffer();
    return true;
  }
  return false;
}

// Print every expression logo.h knows about, space separated, so the serial
// monitor can list what `eye,<0|1>,<name>` accepts.
static void printEyeNames(Print &out) {
  for (size_t i = 0; i < EYE_PAIR_COUNT; i++) {
    if (i) out.print(' ');
    out.print(eye_pairs[i].name);
  }
  out.println();
}

// Bring both buses and both panels up. Expects Serial.begin() to have run
// already; the probe result goes there so a dead panel shows at boot.
static void eyesBegin(const char *bootExpression = "boot") {
  Wire.begin();
  Wire.setClock(BUS_HZ);
  Wire2.begin();
  Wire2.setClock(BUS_HZ);

  Wire2.beginTransmission(OLED_ADDR);
  bool leftOk = Wire2.endTransmission() == 0;
  Wire.beginTransmission(OLED_ADDR);
  bool rightOk = Wire.endTransmission() == 0;
  Serial.print("EYES left (D18/D19): ");
  Serial.print(leftOk ? "ok" : "NO");
  Serial.print("  right (D20/D21): ");
  Serial.println(rightOk ? "ok" : "NO");

  left_eye.setI2CAddress(OLED_ADDR << 1);
  left_eye.begin();
  left_eye.setContrast(0x80);

  right_eye.setI2CAddress(OLED_ADDR << 1);
  right_eye.begin();
  right_eye.setContrast(0x80);

  if (bootExpression) {
    setEye(EYE_LEFT, bootExpression);
    setEye(EYE_RIGHT, bootExpression);
  }
}
