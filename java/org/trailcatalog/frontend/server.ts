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
  },
  location: {
    search: '',
  },
} as any;

import { App } from 'java/org/trailcatalog/client/app';

const server = fastify({
  logger: true,
});

server.register(fastifyRequestContextPlugin);

server.get('/*', async (request: FastifyRequest, reply: FastifyReply) => {
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
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      keys: requestedData,
    }),
  }).then(r => r.json()) as {
    values: unknown[];
  };
  const responseData = response.values;

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
  reply.type('text/html').code(200);
  reply.send(page(render(content), requestedData, response.values));
});

server.listen({ port: 7080 }, (err, address) => {
  if (err) {
    throw err;
  }
  console.log(`Running on ${address}`);
});

function page(content: string, dataKeys: object, dataValues: object): string {
  const data = {
    keys: dataKeys,
    values: dataValues,
  };
  return `
<!DOCTYPE html>
<html dir="ltr" lang="en" class="h-full">
  <head>
    <meta charset="utf-8"/>
    <title>Trailcatalog</title>
    <meta name="description" content="Organizing trails from OpenStreetMap">
    <meta
        name="viewport"
        content="height=height, initial-scale=1, maximum-scale=1, minimum-scale=1, width=device-width" />
    <link rel="stylesheet" type="text/css" href="/static/client.css" />
  </head>
  <body class="h-full">
    <div id="root" class="h-full">${content}</div>
    <script>window.INITIAL_DATA=${JSON.stringify(data)}</script>
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
      actualKey = key;
    }

    const escapedValue = [];
    for (const c of (value as string)) {
      if (c in ESCAPES) {
        escapedValue.push(ESCAPES[c as keyof typeof ESCAPES]);
      } else {
        escapedValue.push(c);
      }
    }

    attributes.push(`${actualKey}="${escapedValue.join('')}"`);
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
