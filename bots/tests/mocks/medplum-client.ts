/**
 * Mock Medplum Client
 *
 * Provides a mock implementation of MedplumClient for unit testing.
 */

import { Resource, Patient, Condition, Observation, MedicationRequest, Task, Provenance, AuditEvent, DocumentReference, Binary } from '@medplum/fhirtypes';

export interface MockResourceStore {
  [key: string]: Resource[];
}

export class MockMedplumClient {
  private resources: MockResourceStore = {};
  private idCounter = 1;

  // Spy functions for verification
  createResourceSpy = jest.fn();
  updateResourceSpy = jest.fn();
  searchResourcesSpy = jest.fn();
  readResourceSpy = jest.fn();

  constructor(initialResources?: MockResourceStore) {
    if (initialResources) {
      this.resources = initialResources;
    }
  }

  async createResource<T extends Resource>(resource: T): Promise<T> {
    this.createResourceSpy(resource);

    const id = `mock-${this.idCounter++}`;
    const created = {
      ...resource,
      id,
      meta: {
        versionId: '1',
        lastUpdated: new Date().toISOString(),
      },
    } as T;

    const type = resource.resourceType;
    if (!this.resources[type]) {
      this.resources[type] = [];
    }
    this.resources[type].push(created);

    return created;
  }

  async updateResource<T extends Resource>(resource: T): Promise<T> {
    this.updateResourceSpy(resource);

    const type = resource.resourceType;
    const index = this.resources[type]?.findIndex((r) => r.id === resource.id);

    if (index !== undefined && index >= 0) {
      const updated = {
        ...resource,
        meta: {
          ...resource.meta,
          versionId: String(parseInt(resource.meta?.versionId || '0') + 1),
          lastUpdated: new Date().toISOString(),
        },
      } as T;
      this.resources[type][index] = updated;
      return updated;
    }

    throw new Error(`Resource ${type}/${resource.id} not found`);
  }

  async readResource<T extends Resource>(resourceType: string, id: string): Promise<T> {
    this.readResourceSpy(resourceType, id);

    const resource = this.resources[resourceType]?.find((r) => r.id === id);
    if (!resource) {
      throw new Error(`Resource ${resourceType}/${id} not found`);
    }
    return resource as T;
  }

  async searchResources<T extends Resource>(
    resourceType: string,
    query?: Record<string, string>
  ): Promise<T[]> {
    this.searchResourcesSpy(resourceType, query);

    let results = (this.resources[resourceType] || []) as T[];

    // Basic filtering based on common query params
    if (query) {
      if (query.patient) {
        results = results.filter((r: any) =>
          r.subject?.reference === query.patient ||
          r.patient?.reference === query.patient
        );
      }
      if (query.status) {
        results = results.filter((r: any) => r.status === query.status);
      }
      if (query._count) {
        results = results.slice(0, parseInt(query._count));
      }
    }

    return results;
  }

  // Helper methods for testing
  addResource<T extends Resource>(resource: T): T {
    const type = resource.resourceType;
    if (!this.resources[type]) {
      this.resources[type] = [];
    }
    this.resources[type].push(resource);
    return resource;
  }

  getResources(resourceType: string): Resource[] {
    return this.resources[resourceType] || [];
  }

  clearResources(): void {
    this.resources = {};
    this.idCounter = 1;
  }

  reset(): void {
    this.clearResources();
    jest.clearAllMocks();
  }
}

/**
 * Create a mock Medplum client with pre-populated test data
 */
export function createMockMedplumClient(options?: {
  patients?: Patient[];
  conditions?: Condition[];
  observations?: Observation[];
  medications?: MedicationRequest[];
}): MockMedplumClient {
  const client = new MockMedplumClient();

  if (options?.patients) {
    options.patients.forEach((p) => client.addResource(p));
  }
  if (options?.conditions) {
    options.conditions.forEach((c) => client.addResource(c));
  }
  if (options?.observations) {
    options.observations.forEach((o) => client.addResource(o));
  }
  if (options?.medications) {
    options.medications.forEach((m) => client.addResource(m));
  }

  return client;
}
