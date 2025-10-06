# Testing Setup Guide

## ✅ Test Environment Setup Complete!

Your test environment is now configured and ready. All 4 contract test files are discovered by Jest.

## Quick Start

### 1. Run Tests (Current State - RED Phase)

```bash
cd functions
npm test
```

**Expected Result**: All tests FAIL ❌ (This is correct for TDD RED phase)

```
Test Suites: 4 failed, 4 total
Tests:       40+ failed, 0 passed, 40+ total
```

**Why failing?**
- API endpoints not implemented yet (tasks T034-T037)
- No server running at `http://localhost:7071/api`
- **This is the correct TDD workflow!**

### 2. View Test Discovery

```bash
npm test -- --listTests
```

Shows all 4 contract test files:
- `tests/contract/provision.test.js`
- `tests/contract/deprovision.test.js`
- `tests/contract/status.test.js`
- `tests/contract/status-list.test.js`

## Test Commands

```bash
# Run all tests
npm test

# Run with verbose output
npm test -- --verbose

# Run specific test file
npm test -- tests/contract/provision.test.js

# Run tests matching a pattern
npm test -- --testNamePattern="authentication"

# Run in watch mode (re-runs on file changes)
npm test -- --watch

# Run with coverage report
npm test -- --coverage
```

## Configuration Files

### Created Files

1. **`functions/jest.config.js`** - Jest configuration
   - Points to tests in `../tests/` directory
   - Sets 30-second timeout
   - Requires 80% code coverage

2. **`functions/jest.setup.js`** - Test environment setup
   - Sets default environment variables
   - Configures fetch API
   - Sets test timeout

3. **`functions/.env.test`** - Environment variables template
   - `VPN_API_ENDPOINT=http://localhost:7071/api`
   - `TEST_API_KEY=test-key-12345`

4. **`tests/README.md`** - Comprehensive test documentation

## Environment Variables

Tests use these environment variables (set in `jest.setup.js`):

- `VPN_API_ENDPOINT`: API base URL (default: `http://localhost:7071/api`)
- `TEST_API_KEY`: Test API key (default: `test-key-12345`)

Override by creating `functions/.env`:

```bash
cp functions/.env.test functions/.env
# Edit .env with your values
```

## TDD Workflow

### Current Status: RED Phase ❌

✅ **Phase 1: RED** - Tests written, all failing (YOU ARE HERE)
- Contract tests created (T010-T013) ✅
- Tests fail because endpoints not implemented ✅

⏳ **Phase 2: GREEN** - Write minimal code to pass tests
- Implement data models (T020-T024)
- Implement services (T025-T028)
- Implement API endpoints (T034-T037)
- Tests should start passing ✅

⏳ **Phase 3: REFACTOR** - Improve code while keeping tests green
- Optimize performance
- Improve error handling
- Add documentation

## Next Steps

To move to the GREEN phase, implement:

1. **T020-T024**: Data models (`functions/shared/models/`)
2. **T025-T028**: Azure services (`functions/shared/services/`)
3. **T029-T033**: Utilities (`functions/shared/utils/`)
4. **T034-T037**: API endpoints (`functions/provision/`, `functions/deprovision/`, `functions/status/`)

Once implemented, run tests to see them pass! 🎉

## Running Tests Against Local Azure Functions

### Option 1: Start Functions Locally

```bash
# Terminal 1: Start Azure Functions
cd functions
npm start
# Server starts on http://localhost:7071

# Terminal 2: Run tests
cd functions
npm test
```

### Option 2: Use Azure Functions Emulator

Install Azure Functions Core Tools:
```bash
npm install -g azure-functions-core-tools@4 --unsafe-perm true
```

Then:
```bash
cd functions
func start
```

## Troubleshooting

### Tests don't run

**Issue**: `No tests found`

**Fix**: Make sure you're in the `functions/` directory:
```bash
cd functions
npm test
```

### Fetch errors

**Issue**: `TypeError: fetch failed`

**Expected**: This is normal when endpoints aren't implemented yet (RED phase)

**To fix later**: Start Azure Functions server (`npm start` in functions/)

### Node.js version

**Requirement**: Node.js 18+

Check version:
```bash
node --version  # Should be >= 18.0.0
```

## Test File Structure

Each contract test includes:

- **Request validation**: Schema, parameters, body
- **Response validation**: Status codes, response schemas
- **Authentication**: API key requirement
- **Performance**: Timeout validation
- **Error handling**: 4xx, 5xx responses

Example from `provision.test.js`:
```javascript
describe('POST /api/vpn/start - StartVPN Contract', () => {
  describe('Request Schema Validation', () => { ... })
  describe('Response Schema Validation', () => { ... })
  describe('Authentication Validation', () => { ... })
  describe('Performance Validation', () => { ... })
  describe('Concurrent Request Handling', () => { ... })
});
```

## Coverage Thresholds

Minimum 80% coverage required for:
- Branches
- Functions
- Lines
- Statements

Run coverage report:
```bash
npm test -- --coverage
```

## Resources

- [tests/README.md](tests/README.md) - Detailed test documentation
- [tasks.md](specs/001-use-existing-documents/tasks.md) - Full implementation tasks
- [quickstart.md](specs/001-use-existing-documents/quickstart.md) - Integration scenarios
- [contracts/](specs/001-use-existing-documents/contracts/) - OpenAPI specs

---

**Status**: ✅ Test setup complete! Ready for TDD development.
