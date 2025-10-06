module.exports = {
  testEnvironment: 'node',
  rootDir: '../',
  testMatch: [
    '<rootDir>/tests/**/*.test.js'
  ],
  collectCoverageFrom: [
    'functions/shared/**/*.js',
    'functions/provision/**/*.js',
    'functions/deprovision/**/*.js',
    'functions/status/**/*.js',
    'functions/config/**/*.js',
    '!**/node_modules/**'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  testTimeout: 30000,
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/functions/jest.setup.js']
};
