export const SERIAL_CONFIG = {
  PORT: process.env.SERIAL_PORT ?? '/dev/tty.usbserial-1410',
  BAUD_RATE: 115200,
  SAMPEL_TARGET: 30,
  LIMITS: {
    FIRST_SAMPLE: { X_MIN: 0, X_MAX: 28, Y_MIN: -3, Y_MAX: 3 },
    PHYSICAL: { X_MIN: 0, X_MAX: 50, Y_MIN: -15, Y_MAX: 15 },
  },
} as const;
