import crypto from 'crypto';
import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fetch from 'node-fetch';
import { fastifyRequestContextPlugin, requestContext } from '@fastify/request-context';

import { checkExists } from 'js/common/asserts';
import { deepEqual } from 'js/common/comparisons';
import { Fragment, Properties, VElementOrPrimitive } from 'js/corgi';
import { ElementFactory } from 'js/corgi/vdom';

import { InitialDataKey } from './data';

declare module '@fastify/request-context' {
  interface RequestContextData {
    cookies: string|undefined;
    initialData: (key: InitialDataKey) => undefined|unknown;
    language: string|undefined;
    redirectTo: string;
    title: string;
    url: string;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

global.window = {
  SERVER_SIDE_RENDER: {
    cookies: function() {
      return requestContext.get('cookies');
    },
    currentUrl: function() {
      return requestContext.get('url');
    },
    initialData: (key: InitialDataKey) => {
      return checkExists(requestContext.get('initialData'))(key);
    },
    language: function() {
      return requestContext.get('language');
    },
    redirectTo: function(url: string) {
      requestContext.set('redirectTo', url);
    },
    setTitle: function(title: string) {
      requestContext.set('title', title);
    },
  },
  devicePixelRation: 1,
  location: {
    search: 'hardcoded-do-not-use',
  },
} as any;

type PageFn = (content: string, title: string, escapedData: string) => string;

export async function serve(
        app: ElementFactory,
        page: PageFn,
        {defaultTitle, initialize, port}: {
          defaultTitle: string;
          initialize?: (f: FastifyInstance) => Promise<void>,
          port: number;
        }):
    Promise<void> {
  const server = fastify({
    logger: true,
  });

  server.register(fastifyRequestContextPlugin);
  server.decorateRequest('userId', '');

  if (initialize) {
    await initialize(server);
  }

  server.get('/*', async (request: FastifyRequest, reply: FastifyReply) => {
    requestContext.set('cookies', request.headers['cookie']);
    requestContext.set(
        'language',
        (request.headers['accept-language'] ?? 'en-US')
            .split(';')[0]
            .split(',')[0]);
    requestContext.set('url', `https://trailcatalog.org${request.url}`);

    // First we run a tracing path to discover what data we need
    const requestedData: InitialDataKey[] = [];
    requestContext.set('initialData', (key: InitialDataKey) => {
      requestedData.push(key);
      return undefined;
    });
    app({}, undefined, () => {});

    let responseData: unknown[];
    if (requestedData.length > 0) {
      const response = await fetch('http://127.0.0.1:7070/api/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'If-None-Match': request.headers['if-none-match'] ?? '',
          'X-User-ID': request.userId,
        },
        body: JSON.stringify({
          keys: requestedData,
        }),
      });

      if (!response.ok) {
        reply.type('text/plain').code(response.status);
        reply.send(response.statusText);
      }

      responseData = (await response.json() as {values: unknown[]}).values;
    } else {
      responseData = [];
    }

    // Finally we re-render with our data
    requestContext.set('initialData', (key: InitialDataKey) => {
      for (let i = 0; i < requestedData.length; ++i) {
        if (deepEqual(key, requestedData[i])) {
          return responseData[i];
        }
      }
      return undefined;
    });
    const content = app({}, undefined, () => {});

    const redirectUrl = requestContext.get('redirectTo');
    if (redirectUrl) {
      reply.redirect(302, encodeURI(redirectUrl));
    }

    reply.type('text/html').code(200);

    const data = {
      keys: requestedData,
      values: responseData,
    };
    const escapedData = JSON.stringify(data).replace(/\//g, '\\/');
    const result =
        page(
            render(content),
            renderText(requestContext.get('title') ?? defaultTitle),
            escapedData);

    const ifNoneMatch = request.headers['if-none-match'];
    const etag = '"' + crypto.createHash('md5').update(result).digest('base64') + '"';
    reply.header('ETag', etag);
    if (ifNoneMatch === etag || ifNoneMatch === `W/${etag}`) {
      reply.code(304);
    } else {
      reply.send(result);
    }
  });

  server.listen({ port }, (err, address) => {
    if (err) {
      throw err;
    }
    console.log(`Running on ${address}`);
  });
}

function render(element: VElementOrPrimitive): string {
  if (element instanceof Object) {
    const properties = renderProperties(element.props);
    const spaceProperties = properties ? ` ${properties}` : '';
    if (element.tag === Fragment) {
      const children = element.children.map(render);
      return children.join('');
    } else if (element.children) {
      const children = element.children.map(render);
      return `<${element.tag}${spaceProperties}>${children.join('')}</${element.tag}>`;
    } else {
      return `<${element.tag}${spaceProperties} />`;
    }
  } else {
    return renderText(element);
  }
}

const ESCAPES = {
  '"': '&#34;',
  '&': '&#38;',
  '<': '&#60;',
  '>': '&#62;',
  '\'': '&#39;',
  '`': '&#96;',
} as const;

function renderProperties(props: Properties): string {
  const attributes = [];
  for (const [key, value] of Object.entries(props)) {
    let actualKey;
    let actualValue = value;
    if (key === 'className') {
      actualKey = 'class';
    } else if (key === 'children' || key === 'unboundEvents') {
      continue;
    } else if (key === 'js') {
      attributes.push('data-js');
      if (value.ref) {
        actualKey = 'data-js-ref';
        actualValue = value.ref;
      } else {
        continue;
      }
    } else {
      actualKey = key.replace('_', '-');
    }

    if (actualValue !== undefined) {
      let rendered;
      if (typeof actualValue === 'string') {
        const escapedValue = [];
        for (const c of actualValue) {
          if (c in ESCAPES) {
            escapedValue.push(ESCAPES[c as keyof typeof ESCAPES]);
          } else {
            escapedValue.push(c);
          }
        }
        rendered = escapedValue.join('');
      } else if (typeof actualValue === 'boolean') {
        if (actualValue) {
          attributes.push(actualKey);
        }
        continue;
      } else {
        rendered = actualValue;
      }

      attributes.push(`${actualKey}="${rendered}"`);
    }
  }
  return attributes.join(' ');
}

function renderText(value: number|string): string {
  const escapedValue = [];
  for (const c of String(value)) {
    if (c in ESCAPES) {
      escapedValue.push(ESCAPES[c as keyof typeof ESCAPES]);
    } else {
      escapedValue.push(c);
    }
  }
  return escapedValue.join('');
}
