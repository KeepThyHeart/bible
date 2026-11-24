/** `fetchUpstream` over NetworkGateway (all egress goes through the gateway and its offline switch). */
import type { INetworkGateway } from '../../services/NetworkGateway';
import type { UpstreamResponse } from './audioProtocol';

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function createGatewayUpstream(getGateway: () => INetworkGateway) {
  return async (url: string, range: string | null): Promise<UpstreamResponse> => {
    const headers: Record<string, string> = {};
    if (range) headers['Range'] = range;
    const res = await getGateway().downloadStream({ url, headers, context: 'audio' });
    const h = res.headers;
    const out: UpstreamResponse['headers'] = {
      'content-type': first(h['content-type']),
      'content-length': first(h['content-length']),
      'content-range': first(h['content-range']),
      'accept-ranges': first(h['accept-ranges']),
    };
    if (res.status !== 200 && res.status !== 206) {
      try { res.request.abort(); } catch { /* ignore */ }
      return { status: res.status, headers: out, body: null };
    }
    const { response, request } = res;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        response.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)));
        response.on('end', () => controller.close());
        response.on('error', (e: Error) => controller.error(e));
        response.on('aborted', () => controller.error(new Error('aborted')));
      },
      cancel() {
        try { request.abort(); } catch { /* ignore */ }
      },
    });
    return { status: res.status, headers: out, body };
  };
}
