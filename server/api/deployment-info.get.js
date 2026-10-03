import { defineEventHandler } from 'h3'

export default defineEventHandler((event) => {
  const config = useRuntimeConfig(event)

  return {
    commit: config.deploymentCommit || 'unknown',
    nodeEnv: process.env.NODE_ENV || 'unknown',
    checkedAt: new Date().toISOString(),
  }
})
