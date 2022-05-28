# corgi

This is a generally sketchy JavaScript library inspired by React and a proprietary framework that I
love. The basic idea is to separate views from controller logic, so you end up with standard TSX
views like `overview_element.tsx` and corgi controllers like `overview_controller.ts.` Controllers
are lazily initialized and event driven, and can communicate with each other by firing events. When
a controller needs to update view state, it calls `updateState({background: 'red'})` and the view
is reinvoked and patched into the page. This framework also allows controllers to depend on
singleton classes, called services. Finally, when a controller's element is removed from the page,
it is disposed.

This framework, corgi, is BSD 3-clause licensed separately from the rest of this repository (which
is AGPL.)

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
