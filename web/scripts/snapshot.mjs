// One-time: build the Daytona snapshot that holds Python, pandas and the price files.
// usage: DAYTONA_API_KEY=... node scripts/snapshot.mjs
import { Daytona, Image } from "@daytonaio/sdk";

const name = process.env.DAYTONA_SNAPSHOT ?? "paper-desk";
const image = Image.debianSlim("3.12")
  .pipInstall(["pandas==2.2.3", "numpy==2.1.3"])
  .addLocalDir(new URL("../../engine/prices", import.meta.url).pathname, "/home/daytona/prices");

const daytona = new Daytona();
await daytona.snapshot.delete(name).catch(() => {});
await daytona.snapshot.create({ name, image }, { onLogs: (l) => process.stdout.write(l) });
console.log(`\nsnapshot ${name} ready`);

const t0 = Date.now();
const sb = await daytona.create({ snapshot: name, networkBlockAll: true, ephemeral: true });
console.log(`sandbox start: ${Date.now() - t0} ms`);
console.log((await sb.process.executeCommand("python -c 'import pandas; print(pandas.__version__)' && ls prices | wc -l", "/home/daytona")).result);
await daytona.delete(sb);
