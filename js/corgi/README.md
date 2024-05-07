# corgi

This is a generally sketchy JavaScript library inspired by React and a proprietary framework that I
love. The basic idea is to separate views from controller logic, so you end up with standard TSX
views like `overview_element.tsx` and corgi controllers like `overview_controller.ts.` Controllers
are lazily initialized and event driven, and can communicate with each other by firing events. When
a controller needs to update view state, it calls `updateState({background: 'red'})` and the view
is reinvoked and patched into the page. This framework also allows controllers to depend on
singleton classes, called services. Finally, when a controller's element is removed from the page,
it is disposed.

This framework, corgi, and the supporting //js/common, //js/server, and //js/emu libraries, are BSD
3-clause licensed separately from the rest of this repository (which is AGPL.)

## Example snippet

`cookie_clicker_controller.ts`:

```ts
export interface State {
  count: number;
}

export class OverviewController extends Controller<{}, EmptyDeps, HTMLElement, State> {

  constructor(response: Response<OverviewController>) {
    super(response);
  }

  click(): void {
    this.updateState({
      count: this.state.count + 1,
    });
  }
```

`cookie_clicker_element.tsx`:

```ts
export function CookierClickerElement(
    props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      count: 0,
    };
  }

  return <>
    <button
        js={corgi.bind({
          controller: CookieClickerController,
          args: undefined,
          events: {
            click: 'click',
          },
          state: [state, updateState],
        })}
    >
      {state.count} cookies
    </button>
  </>;
}
```

### More fancy snippet

`cookie_clicker_element.tsx`:

```ts
export function CookierClickerElement(
    props: {}, state: State|undefined, updateState: (newState: State) => void) {
  if (!state) {
    state = {
      count: 0,
    };
  }

  return <>
    <div
        js={corgi.bind({
          controller: CookieClickerController,
          args: undefined,
          state: [state, updateState],
        })}
    >
      {state.count} cookies
      <a unboundEvents={{click: 'click'}}>Click</a>
    </div>
  </>;
}
```

## vdom

This library has a vdom rendering, hydration, and patching implemention. The major source of
complexity comes from handling fragments. As an example, consider the following.

```tsx
<>
  <>Some</>
  <>text</>
  <></>
  <>
    <>that</>
    <><span>needs patching</span></>
  </>
</>
```

will render as

```html
Sometextthat<span>needs patching</span>
```

which is exactly equivalent to the result of rendering

```tsx
<>
  <>Sometext</>
  <>that</>
  <span>needs patching</span>
</>
```

This ends up being challenging when patching because the DOM itself does not have enough information
to know where a fragment begins or ends (consider especially the `<></>` fragment in the example
above, if we patched elements into it you could only know where to place them by looking at its
sibling fragments.) We deal with this by creating placeholder nodes (text nodes containing the
string `''`) when a fragment is empty and placing those in the DOM so we can anchor future elements.
An alternative approach would be to look at the adjacent fragments when processing a fragment, but
it's challenging to write in a readable fashion because those fragments may be deeply nested (and
they may also all be ultimately empty and so unable to provide any anchoring information.) The code
that handles patching fragments is mostly contained by `binder.ts#patchChildren`.

Hydration has a similar but easier problem where we need to map a fragment onto the DOM while also
handling merged text nodes. For an example, consider the HTML above.

```html
Sometextthat<span>needs patching</span>
```

has the node structure

```tsx
<>
  Sometextthat
  <span>needs patching</span>
</>
```

needs to be mapped into

```tsx
<>
  <>Some</>
  <>text</>
  <></>
  <>
    <>that</>
    <><span>needs patching</span></>
  </>
</>
```

This can only be performed by splitting the `Sometextthat` text node into multiple text nodes and
recursively processing the fragments.
