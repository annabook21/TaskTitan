/**
 * Unit tests for transactions.ts (executeSaga)
 * Asserts cascade compensation: when a step fails, previous steps are compensated in reverse order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeSaga, type SagaStep } from './transactions';

describe('executeSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success and all results when all steps succeed', async () => {
    const steps: SagaStep<number>[] = [
      {
        name: 'Step 1',
        execute: vi.fn().mockResolvedValue(1),
        compensate: vi.fn().mockResolvedValue(undefined),
      },
      {
        name: 'Step 2',
        execute: vi.fn().mockResolvedValue(2),
        compensate: vi.fn().mockResolvedValue(undefined),
      },
    ];
    const result = await executeSaga(steps);
    expect(result.success).toBe(true);
    expect(result.results).toEqual([1, 2]);
    expect(steps[0].execute).toHaveBeenCalledTimes(1);
    expect(steps[1].execute).toHaveBeenCalledTimes(1);
    expect(steps[0].compensate).not.toHaveBeenCalled();
    expect(steps[1].compensate).not.toHaveBeenCalled();
  });

  it('calls compensate in reverse order when a step fails', async () => {
    const compensate1 = vi.fn().mockResolvedValue(undefined);
    const compensate2 = vi.fn().mockResolvedValue(undefined);
    const steps: SagaStep<number>[] = [
      { name: 'Delete activities', execute: vi.fn().mockResolvedValue(1), compensate: compensate1 },
      { name: 'Delete components', execute: vi.fn().mockResolvedValue(2), compensate: compensate2 },
      {
        name: 'Delete project',
        execute: vi.fn().mockRejectedValue(new Error('DynamoDB throttled')),
        compensate: vi.fn().mockResolvedValue(undefined),
      },
    ];
    const result = await executeSaga(steps);
    expect(result.success).toBe(false);
    expect(result.failedStep).toBe(2);
    expect(result.failedStepName).toBe('Delete project');
    expect(result.results).toEqual([1, 2]);
    // Compensate in reverse order: step 2 (index 1) first, then step 1 (index 0)
    expect(compensate2).toHaveBeenCalledTimes(1);
    expect(compensate1).toHaveBeenCalledTimes(1);
    expect(compensate2.mock.invocationCallOrder[0]).toBeLessThan(compensate1.mock.invocationCallOrder[0]);
  });

  it('reports compensation errors if compensate throws', async () => {
    const steps: SagaStep<number>[] = [
      {
        name: 'Step 1',
        execute: vi.fn().mockResolvedValue(1),
        compensate: vi.fn().mockRejectedValue(new Error('Compensate failed')),
      },
      {
        name: 'Step 2',
        execute: vi.fn().mockRejectedValue(new Error('Execute failed')),
        compensate: vi.fn().mockResolvedValue(undefined),
      },
    ];
    const result = await executeSaga(steps);
    expect(result.success).toBe(false);
    expect(result.compensationErrors).toHaveLength(1);
    expect(result.compensationErrors![0].message).toBe('Compensate failed');
  });
});
