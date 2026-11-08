import type { TestProject } from 'vitest/node';
import { startTestInfra } from './index.js';

export default async function setup(project: TestProject) {
  const infra = await startTestInfra();
  project.provide('dynamoEndpoint', infra.dynamoEndpoint);
  project.provide('s3Endpoint', infra.s3Endpoint);
  return async () => {
    await infra.stop();
  };
}
