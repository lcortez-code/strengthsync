const mode = process.argv[2];
process.stdin.resume();
if (mode === "hang") {
  while (true) Math.sqrt(123);
} else if (mode === "memory") {
  global.bytes = Buffer.alloc(96 * 1024 * 1024, 1);
  setInterval(() => {}, 1000);
} else if (mode === "output") {
  process.stdout.write("x".repeat(1024 * 1024));
} else if (mode === "environment") {
  process.stdout.write(JSON.stringify({ ok: true, result: { env: process.env, execArgv: process.execArgv } }));
} else {
  process.exit(1);
}
