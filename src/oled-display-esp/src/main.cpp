#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>
#include "logo.h"

// Both panels sit at 0x3C on separate hardware I2C buses, so no address
// jumper is needed. Bus 0 drives the left eye, bus 1 the right.
#define LEFT_SDA 21
#define LEFT_SCL 22
#define RIGHT_SDA 16
#define RIGHT_SCL 17
#define OLED_ADDR 0x3C
#define FRAME_MS 800

U8G2_SH1106_128X64_NONAME_F_HW_I2C left_eye(U8G2_R0, U8X8_PIN_NONE);
U8G2_SH1106_128X64_NONAME_F_2ND_HW_I2C right_eye(U8G2_R0, U8X8_PIN_NONE);

static bool probe(TwoWire &bus, const char *label) {
  bus.beginTransmission(OLED_ADDR);
  bool ok = bus.endTransmission() == 0;
  Serial.printf("%s panel at 0x%02X: %s\n", label, OLED_ADDR, ok ? "yes" : "NO");
  return ok;
}

void setup() {
  Serial.begin(115200);
  delay(200);

  Wire.begin(LEFT_SDA, LEFT_SCL, 400000);
  Wire1.begin(RIGHT_SDA, RIGHT_SCL, 400000);

  probe(Wire, "left");
  probe(Wire1, "right");

  left_eye.setI2CAddress(OLED_ADDR << 1);
  left_eye.begin();
  left_eye.setContrast(0x80);

  right_eye.setI2CAddress(OLED_ADDR << 1);
  right_eye.begin();
  right_eye.setContrast(0x80);

  Serial.printf("cycling %u expressions\n", (unsigned)EYE_PAIR_COUNT);
}

void loop() {
  for (size_t i = 0; i < EYE_PAIR_COUNT; i++) {
    const EyePair &pair = eye_pairs[i];

    left_eye.clearBuffer();
    left_eye.drawXBM(0, 0, EYE_WIDTH, EYE_HEIGHT, pair.left);

    right_eye.clearBuffer();
    right_eye.drawXBM(0, 0, EYE_WIDTH, EYE_HEIGHT, pair.right);

    // Send back to back so both panels update as close together as possible.
    left_eye.sendBuffer();
    right_eye.sendBuffer();

    Serial.printf("[%u/%u] %s\n", (unsigned)i + 1, (unsigned)EYE_PAIR_COUNT,
                  pair.name);
    delay(FRAME_MS);
  }
}
