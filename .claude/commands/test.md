# Test Runner

Run tests for the FabricEMR bots.

## Usage

- `/test` - Run all tests
- `/test unit` - Run unit tests only
- `/test integration` - Run integration tests only
- `/test e2e` - Run end-to-end tests (runs sequentially)
- `/test coverage` - Run tests with coverage report

## Instructions

Based on the argument provided, run the appropriate npm script from the `fabricEMR/bots` directory:

| Argument | Command |
|----------|---------|
| (none) | `npm test` |
| unit | `npm run test:unit` |
| integration | `npm run test:integration` |
| e2e | `npm run test:e2e` |
| coverage | `npm run test:coverage` |

After running tests:
1. Report the pass/fail summary
2. If tests fail, identify the failing test files and provide a brief analysis
3. Suggest fixes if the failures are obvious

## Example

User: `/test unit`

Action: Run `cd /Users/arash/FabricEMR/fabricEMR/bots && npm run test:unit`
