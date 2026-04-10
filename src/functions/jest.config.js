'use strict';

/** @type {import('jest').Config} */
module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  // # Reason: node_modules live under src/functions/, not the repo root — must be explicit
  modulePaths: ['<rootDir>/src/functions/node_modules'],
  collectCoverageFrom: [
    '<rootDir>/src/functions/**/*.js',
    '!<rootDir>/src/functions/jest.config.js',
    // azureClient.js is infrastructure/SDK wiring — always mocked in tests
    '!<rootDir>/src/functions/shared/azureClient.js',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 60,
      lines: 80,
    },
  },
};
