# common

These are some utility functions.

This folder and the associated framework, corgi, are BSD 3-clause licensed separately from the rest
of this repository (which is AGPL.)

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
