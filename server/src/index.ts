import { buildApp } from './server.js';

const { app, ctx } = await buildApp();

const shutdown = async (signal: string) => {
  console.log(`[blockwork] ${signal} received, closing`);
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: ctx.config.port, host: ctx.config.host });
console.log(
  `[blockwork] listening on http://${ctx.config.host}:${ctx.config.port} ` +
    `(events: ${ctx.state.headSeq}, builders: ${ctx.records.agents.size}, data: ${ctx.config.dataDir})`,
);
