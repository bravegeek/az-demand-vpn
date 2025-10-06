# Test Suite - On-Demand VPN Provisioning System

This directory contains comprehensive tests for the VPN provisioning system following Test-Driven Development (TDD) principles.

## Test Structure

```
tests/
├── contract/          # API contract tests (T010-T013)
│   ├── provision.test.js       # POST /api/vpn/start
│   ├── deprovision.test.js     # POST /api/vpn/stop
│   ├── status.test.js          # GET /api/vpn/status/{sessionId}
│   └── status-list.test.js     # GET /api/vpn/status
├── integration/       # End-to-end tests (T014-T019)
│   └── (to be created)
└── unit/             # Unit tests (T048-T051)
    └── (to be created)
```

## Setup

### Prerequisites

- Node.js 18+ installed
- Azure Functions Core Tools (optional, for running functions locally)

### 1. Install Dependencies

```bash
cd functions
npm install
```

### 2. Configure Environment

The tests use environment variables defined in `jest.setup.js`. Default values:
- `VPN_API_ENDPOINT`: `http://localhost:7071/api`
- `TEST_API_KEY`: `test-key-12345`

To override, create a `.env` file in the `functions/` directory:

```bash
cp .env.test .env
# Edit .env with your values
```

## Running Tests

### Run All Tests

```bash
cd functions
npm test
```

### Run Specific Test Suites

```bash
# Contract tests only
npm test -- tests/contract/

# Specific contract test
npm test -- tests/contract/provision.test.js

# Integration tests only
npm test -- tests/integration/

# Unit tests only
npm test -- tests/unit/
```

### Run Tests in Watch Mode

```bash
npm test -- --watch
```

### Run Tests with Coverage

```bash
npm test -- --coverage
```

Coverage thresholds (80% minimum):
- Branches: 80%
- Functions: 80%
- Lines: 80%
- Statements: 80%

## Test Categories

### Contract Tests (T010-T013)

Validate API contracts against OpenAPI specifications in `specs/001-use-existing-documents/contracts/`:

- **T010**: `provision.test.js` - StartVPN endpoint validation
- **T011**: `deprovision.test.js` - StopVPN endpoint validation
- **T012**: `status.test.js` - StatusVPN single session endpoint
- **T013**: `status-list.test.js` - StatusVPN list endpoint

**Status**: ✅ Complete (expecting failures until implementation)

### Integration Tests (T014-T019)

End-to-end scenarios from `quickstart.md`:

- **T014**: Happy Path VPN Lifecycle
- **T015**: Concurrent Request Handling
- **T016**: Auto-Shutdown on Idle
- **T017**: Quota and Retry Handling
- **T018**: Maximum Concurrent Users
- **T019**: Security and Authentication

**Status**: ⏳ Pending

### Unit Tests (T048-T051)

Isolated service and utility tests:

- **T048**: ACI Service tests
- **T049**: Storage Service tests
- **T050**: Validation utility tests
- **T051**: Retry utility tests

**Status**: ⏳ Pending

## TDD Workflow

### Current Phase: RED ❌

All contract tests should **FAIL** because the API endpoints haven't been implemented yet. This is expected and correct.

### Next Steps:

1. **GREEN phase**: Implement API endpoints (T034-T037) to make tests pass
2. **REFACTOR phase**: Clean up and optimize implementation

## Running Tests Against Local Functions

To run tests against a local Azure Functions instance:

### 1. Start Azure Functions

```bash
cd functions
npm start
# Functions will start on http://localhost:7071
```

### 2. Run Tests (in another terminal)

```bash
cd functions
npm test
```

## Expected Test Results (Current State)

Since we're in the RED phase (TDD), expect these results:

```
Contract Tests: 4 suites, ~40+ tests, ALL FAILING ❌
  - provision.test.js: FAIL (endpoint not implemented)
  - deprovision.test.js: FAIL (endpoint not implemented)
  - status.test.js: FAIL (endpoint not implemented)
  - status-list.test.js: FAIL (endpoint not implemented)

Total: 0 passed, 40+ failed
```

**This is correct!** Tests should fail until we implement the endpoints.

## Troubleshooting

### Tests Can't Connect to API

**Error**: `fetch failed` or `ECONNREFUSED`

**Solution**: Make sure Azure Functions is running:
```bash
cd functions
npm start
```

Or update `VPN_API_ENDPOINT` in your environment.

### Node.js Version Error

**Error**: `fetch is not defined`

**Solution**: Upgrade to Node.js 18+:
```bash
node --version  # Should be 18.0.0 or higher
```

### Test Timeout Errors

**Error**: `Exceeded timeout of 30000 ms`

**Solution**: Increase timeout in `jest.config.js` or specific tests:
```javascript
jest.setTimeout(60000);
```

## Performance Requirements

Tests validate these performance targets:

- **Provisioning**: <2 minutes (FR-001)
- **Deprovisioning**: <1 minute (FR-002)
- **Status queries**: <5 seconds (FR-024)
- **VPN connection**: <30 seconds (FR-025)

## Contributing

When adding new tests:

1. Follow TDD: Write test FIRST, then implementation
2. Use descriptive test names
3. Validate against OpenAPI contracts
4. Include performance assertions
5. Add cleanup code in `afterEach`/`afterAll`

## References

- [tasks.md](../specs/001-use-existing-documents/tasks.md) - Full task breakdown
- [quickstart.md](../specs/001-use-existing-documents/quickstart.md) - Integration scenarios
- [contracts/](../specs/001-use-existing-documents/contracts/) - OpenAPI specifications
