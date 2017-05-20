import RTMClient, { RTMClientEvents, RTMMessageTypes } from '../';
import { WebSocket, Server } from 'mock-socket';
import delay from 'delay';

const SERVER_TIMEOUT = 200;
const CLIENT_PING_INTERVAL = 100;
const WAIT_SERVER_CLOSE_TIMEOUT = 1000;
const KEEP_ALIVE_TIMEOUT = 2000;
const BACKOFF_MULTIPLIER = 100;

const mockUrl = 'ws://rtm.local.bearychat.com/nimbus/ws:fake-token';
let mockServer = null;

function createReplyMessage(options) {
  return JSON.stringify({
    code: 0,
    status: 'ok',
    ts: Date.now(),
    type: RTMMessageTypes.REPLY,
    ...options
  });
}

function setupServer() {
  mockServer = new Server(mockUrl);

  mockServer.on('connection', server => {

    let timeoutId;
    const clearServerTimeout = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = void 0;
      }
    };
    const resetServerTimeout = () => {
      clearServerTimeout();
      timeoutId = setTimeout(() => {
        server.close();
      }, SERVER_TIMEOUT);
    };

    resetServerTimeout();

    server.on('message', message => {
      resetServerTimeout();

      message = JSON.parse(message);

      switch (message.type) {
        case RTMMessageTypes.PING:
          mockServer.send(createReplyMessage({
            call_id: message.call_id
          }));
          break;
        default:
      }
    });
  });
}

function stopServer() {
  mockServer.stop();
  mockServer = null;
}

beforeEach(setupServer);

afterEach(stopServer);

test('server disconnects without heartbeat', () => {
  return new Promise(async (resolve, reject) => {
    const ws = new WebSocket(mockUrl);

    ws.onerror = reject;
    ws.onclose = resolve;

    ws.send(JSON.stringify({
      call_id: 1,
      type: RTMMessageTypes.PING
    }));

    await delay(WAIT_SERVER_CLOSE_TIMEOUT);
    reject(new Error('Server should have closed.'));
  });
});

test('keep alive', () => {
  return new Promise(async (resolve, reject) => {
    const client = new RTMClient({
      url: mockUrl,
      WebSocket,
      pingInterval: CLIENT_PING_INTERVAL
    });

    client.on(RTMClientEvents.ERROR, reject);
    client.on(RTMClientEvents.CLOSE, resolve);

    await delay(KEEP_ALIVE_TIMEOUT);

    client.close();
  });
});

test('reconnect', () => {
  return new Promise(async (resolve, reject) => {
    const client = new RTMClient({
      url: mockUrl,
      WebSocket,
      pingInterval: CLIENT_PING_INTERVAL,
      backoffMultiplier: BACKOFF_MULTIPLIER
    });

    const onlineHandler = jest.fn(async () => {
      // stop server then restart later
      mockServer.close();
      stopServer();
      setupServer();
      await delay(100);
    });

    const offlineHandler = jest.fn();

    client.on(RTMClientEvents.ONLINE, onlineHandler);
    client.on(RTMClientEvents.OFFLINE, offlineHandler);

    await delay(3000);

    expect(onlineHandler.mock.calls.length).toBeGreaterThan(1);
    expect(offlineHandler.mock.calls.length).toBeGreaterThan(1);

    resolve();
  });
});
