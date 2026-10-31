import { SECONDARY_BUTTON } from 'js/pika/buttons';

// Renders the page that the login popup and the invite page's redirect open. The frontend serves
// it, but it lives in client/ so that tailwind generates its classes.
export function loginPage(
    providers: Array<{href: string; label: string; logo: string}>,
    staticPrefix: string): string {
  const buttons =
      providers.map(({href, label, logo}) => `
        <a class="${SECONDARY_BUTTON} w-60" href="${href}">
          <span class="flex gap-2 items-center justify-center">
            <img alt="" class="h-4" src="${logo}" />
            ${label}
          </span>
        </a>`);
  return `<!DOCTYPE html>
<html dir="ltr" lang="en" class="h-full">
  <head>
    <meta charset="utf-8"/>
    <title>Log in - trails.lat</title>
    <meta name="robots" content="noindex">
    <meta name="viewport" content="initial-scale=1, width=device-width" />
    <link rel="stylesheet" type="text/css" href="${staticPrefix}/client.css" />
    <link rel="icon" href="/static/favicon.webp" type="image/webp" />
  </head>
  <body class="bg-white flex flex-col gap-3 h-full items-center px-4 py-12 text-gray-900">
    <img alt="" class="h-16" src="/static/cat_moon_dark.webp" />
    <div class="font-bold mb-3 text-lg">Log in to trails.lat</div>
    ${buttons.join('')}
  </body>
</html>
`;
}
