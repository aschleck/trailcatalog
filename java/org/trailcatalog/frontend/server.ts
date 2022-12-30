import fastify, { FastifyRequest, FastifyReply } from 'fastify';
import fetch from 'node-fetch';
import { fastifyRequestContextPlugin, requestContext } from '@fastify/request-context';

import { deepEqual } from 'js/common/comparisons';
import { Properties, VElementOrPrimitive } from 'js/corgi';

import { InitialDataKey } from '../client/common/ssr_aware';
import { ViewsService } from '../client/views/views_service';

global.window = {
  SERVER_SIDE_RENDER: {
    currentUrl: function() {
      return requestContext.get('url');
    },
    initialData: (key: InitialDataKey) => {
      return requestContext.get('initialData')(key);
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
  location: {
    search: 'hardcoded-do-not-use',
  },
} as any;

import { App } from 'java/org/trailcatalog/client/app';

const server = fastify({
  logger: true,
});

server.register(fastifyRequestContextPlugin);

server.get('/*', async (request: FastifyRequest, reply: FastifyReply) => {
  requestContext.set(
      'language',
      (request.headers['accept-language'] ?? 'en-US')
          .split(';')[0]
          .split(',')[0]);
  requestContext.set('url', `https://trailcatalog.org${request.url}`);

  // TODO(april): such a janky way to check for 404.
  try {
    ViewsService.getActiveRoute();
  } catch (ex) {
    reply.code(404).send('Not Found');
    return;
  }

  // First we run a tracing path to discover what data we need
  const requestedData: InitialDataKey[] = [];
  requestContext.set('initialData', (key: InitialDataKey) => {
    requestedData.push(key);
    return undefined;
  });
  App({}, undefined, () => {});

  const response = await fetch('http://127.0.0.1:7070/api/data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'If-None-Match': request.headers['if-none-match'] ?? '',
    },
    body: JSON.stringify({
      keys: requestedData,
    }),
  });

  if (!response.ok) {
    reply.type('text/plain').code(response.status);
    reply.send(response.statusText);
  }

  const responseData = (await response.json() as {values: unknown[]}).values;

  // Finally we re-render with our data
  requestContext.set('initialData', (key: InitialDataKey) => {
    for (let i = 0; i < requestedData.length; ++i) {
      if (deepEqual(key, requestedData[i])) {
        return responseData[i];
      }
    }
    return undefined;
  });
  const content = App({}, undefined, () => {});

  const redirectUrl = requestContext.get('redirectTo');
  if (redirectUrl) {
    reply.redirect(302, encodeURI(redirectUrl));
  }

  reply.type('text/html').code(200);
  const etag = response.headers.get('ETag');
  if (etag) {
    reply.header('ETag', etag);
  }
  reply.send(
      page(
          render(content),
          requestContext.get('title') ?? 'Trailcatalog',
          requestedData,
          responseData));
});

server.listen({ port: 7080 }, (err, address) => {
  if (err) {
    throw err;
  }
  console.log(`Running on ${address}`);
});

function page(content: string, title: string, dataKeys: object, dataValues: object): string {
  const data = {
    keys: dataKeys,
    values: dataValues,
  };
  const escapedData = JSON.stringify(data).replace(/\//g, '\\/');
  return `
<!DOCTYPE html>
<html dir="ltr" lang="en" class="h-full">
  <head>
    <meta charset="utf-8"/>
    <title>${renderText(title)}</title>
    <meta name="description" content="Organizing trails from OpenStreetMap">
    <meta
        name="viewport"
        content="height=height, initial-scale=1, maximum-scale=1, minimum-scale=1, width=device-width" />
    <link rel="stylesheet" type="text/css" href="/static/client.css" />
  </head>
  <body class="h-full">
    <div id="root" class="h-full">${content}</div>
    <script>window.INITIAL_DATA=${escapedData}</script>
    <script src="/static/client.js"></script>
  </body>
</html>
`;
}

function render(element: VElementOrPrimitive): string {
  if (element instanceof Object) {
    const properties = renderProperties(element.props);
    const spaceProperties = properties ? ` ${properties}` : '';
    if (element.children) {
      const children = element.children.map(render);
      return `<${element.element}${spaceProperties}>${children.join('')}</${element.element}>`;
    } else {
      return `<${element.element}${spaceProperties} />`;
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

function renderProperties(props: Properties<HTMLElement>): string {
  const attributes = [];
  for (const [key, value] of Object.entries(props)) {
    let actualKey;
    if (key === 'className') {
      actualKey = 'class';
    } else if (key === 'children' || key === 'js' || key === 'unboundEvents') {
      continue;
    } else {
      actualKey = key.replace('_', '-');
    }

    if (value !== undefined) {
      let rendered;
      if (typeof value === 'string') {
        const escapedValue = [];
        for (const c of value) {
          if (c in ESCAPES) {
            escapedValue.push(ESCAPES[c as keyof typeof ESCAPES]);
          } else {
            escapedValue.push(c);
          }
        }
        rendered = escapedValue.join('');
      } else {
        rendered = value;
      }

      attributes.push(`${actualKey}="${rendered}"`);
    } else {
      attributes.push(actualKey);
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
