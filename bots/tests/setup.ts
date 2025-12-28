/**
 * Jest Test Setup
 *
 * Global setup for all tests including mocks and utilities.
 */

// Extend Jest matchers
expect.extend({
  toBeValidFHIRResource(received, resourceType: string) {
    const pass =
      received &&
      typeof received === 'object' &&
      received.resourceType === resourceType;

    return {
      pass,
      message: () =>
        pass
          ? `Expected ${JSON.stringify(received)} not to be a valid ${resourceType} resource`
          : `Expected ${JSON.stringify(received)} to be a valid ${resourceType} resource`,
    };
  },

  toHaveConfidenceAbove(received, threshold: number) {
    const pass = received && received.confidence >= threshold;
    return {
      pass,
      message: () =>
        pass
          ? `Expected confidence ${received.confidence} not to be above ${threshold}`
          : `Expected confidence ${received.confidence} to be above ${threshold}`,
    };
  },
});

// Global test timeout
jest.setTimeout(30000);

// Mock console.error to track errors
const originalError = console.error;
beforeAll(() => {
  console.error = jest.fn((...args) => {
    // Still log to console for debugging
    originalError.apply(console, args);
  });
});

afterAll(() => {
  console.error = originalError;
});

// Clear all mocks between tests
afterEach(() => {
  jest.clearAllMocks();
});

// TypeScript declarations for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidFHIRResource(resourceType: string): R;
      toHaveConfidenceAbove(threshold: number): R;
    }
  }
}

export {};
