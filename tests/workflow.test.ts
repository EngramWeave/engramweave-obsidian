import { expect, it, vi } from 'vitest';
import type { Document, DraftReview } from '@engramweave/contracts';
import type { CoreClient } from '../src/connection';
import { Workflow } from '../src/workflow';

it('submits one Core-owned round, retaining its request ID after uncertain delivery even when Source stage changed', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('Lost response')).mockResolvedValueOnce({round:{id:'accepted',status:'succeeded'}});
  const workflow = new Workflow({request} as unknown as CoreClient); const source = {path:'20_Sources/one.md',revision:'a'.repeat(64)} as Document;
  await expect(workflow.compile(source,'knowledge')).rejects.toThrow('Lost response');await workflow.compile({...source,revision:'b'.repeat(64)},'knowledge');
  expect(request.mock.calls[0]![0]).toBe('/v1/processing-rounds');expect(request.mock.calls[1]![1]).toEqual(request.mock.calls[0]![1]);expect(request).toHaveBeenCalledTimes(2);
});
it('sends only the explicitly selected task and does not orchestrate Compiler or the other Analyzer', async () => {
  const request = vi.fn().mockResolvedValue({job:{id:'selected'}});const workflow = new Workflow({request} as unknown as CoreClient);
  await workflow.analyze({source:{path:'20_Sources/one.md',revision:'a'.repeat(64)},draft:{path:'30_Drafts/one.md',revision:'b'.repeat(64)}} as DraftReview,'','review');
  expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0]).toEqual(['/v1/analyses',expect.objectContaining({task:'review'})]);
});
