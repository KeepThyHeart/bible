import { render } from 'preact';
import { Harness } from './Harness';
import { buildServices } from './services';

const app = document.getElementById('app')!;
const q = new URLSearchParams(location.search);
const wav = q.get('wav');

buildServices().then(
  (services) => {
    render(
      <Harness services={services} initialWav={wav ? { url: wav, ref: q.get('ref') ?? undefined } : undefined} autoBench={q.has('autobench')} />,
      app,
    );
  },
  (e: unknown) => {
    app.textContent = `The speech harness could not start: ${e instanceof Error ? e.message : String(e)}`;
  },
);
