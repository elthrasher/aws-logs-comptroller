module.exports = {
  collectCoverage: true,
  globals: {
    'ts-jest': {
      tsconfig: 'tsconfig.dev.json',
    },
  },
  roots: ['<rootDir>/test'],
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
};
