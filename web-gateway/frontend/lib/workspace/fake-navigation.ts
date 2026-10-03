/**
 * A browser history for the tests, with the Navigation API on top of it.
 *
 * jsdom has neither the Navigation API nor a history that says where it is, and
 * the leave guard needs both (`useLeaveGuard`): the entry the page is on, a
 * stable key for each entry, `traverseTo(key)`, and the `navigate` event. This
 * keeps a list of entries, follows `history.pushState` and `replaceState` (so a
 * page that pushes its own steps shows up in it), and moves like a browser
 * does: a traversal first fires a `navigate` event (`navigationType`
 * "traverse", with the `destination`), which is cancelable unless
 * `cancelable` is turned off and which stops the traversal when prevented; then
 * it changes the URL and fires `currententrychange`, and `popstate` after a
 * microtask (a task in a browser). `traverseTo` is a traversal.
 *
 * Only for tests; no page imports it.
 */

export interface FakeEntry {
  key: string;
  url: string;
}

export class FakeNavigation extends EventTarget {
  entries: FakeEntry[];
  index: number;
  /** Whether a traversal's `navigate` event can be cancelled: a browser may decline. */
  cancelable = true;
  /** How many traversals were cancelled. */
  cancelled = 0;
  private next = 0;
  private readonly push: History["pushState"];
  private readonly replace: History["replaceState"];

  /** `urls` are the entries from oldest to newest and `index` the one the page
   *  is on; the location is set to it. */
  constructor(urls: string[], index = urls.length - 1) {
    super();
    this.entries = urls.map((url) => this.entry(url));
    this.index = index;
    this.push = window.history.pushState.bind(window.history);
    this.replace = window.history.replaceState.bind(window.history);
    this.replace(null, "", urls[index]);
    window.history.pushState = (data, unused, url) => {
      this.push(data, unused, url);
      if (url !== undefined && url !== null) {
        this.entries = [...this.entries.slice(0, this.index + 1), this.entry(this.resolve(url))];
        this.index = this.entries.length - 1;
        this.dispatchEvent(new Event("currententrychange"));
      }
    };
    window.history.replaceState = (data, unused, url) => {
      this.replace(data, unused, url);
      if (url !== undefined && url !== null) {
        // Same key: a replaced entry is the same entry to the Navigation API.
        this.entries[this.index] = { key: this.entries[this.index].key, url: this.resolve(url) };
        this.dispatchEvent(new Event("currententrychange"));
      }
    };
    (window as unknown as { navigation: FakeNavigation }).navigation = this;
  }

  get currentEntry(): FakeEntry {
    return this.entries[this.index];
  }

  /** The entry's key at `index`, for a test to name an entry. */
  keyAt(index: number): string {
    return this.entries[index].key;
  }

  /** The person presses Back (`-1`) or Forward (`1`), or jumps further. */
  go(delta: number) {
    this.traverse(this.index + delta);
  }

  /** The page asks for an entry by key, as `navigation.traverseTo` does. */
  traverseTo(key: string): { committed: Promise<unknown>; finished: Promise<unknown> } {
    const index = this.entries.findIndex((entry) => entry.key === key);
    if (index < 0) throw new DOMException("No such entry", "InvalidStateError");
    this.traverse(index);
    return { committed: Promise.resolve(), finished: Promise.resolve() };
  }

  /** The URL of every entry, oldest first, for a test to check the page added
   *  or rewrote none. */
  urls(): string[] {
    return this.entries.map((entry) => entry.url);
  }

  /** Put the real history back; the page's own pushes go straight to jsdom again. */
  uninstall() {
    window.history.pushState = this.push;
    window.history.replaceState = this.replace;
    delete (window as unknown as { navigation?: unknown }).navigation;
  }

  private traverse(index: number) {
    if (index < 0 || index >= this.entries.length || index === this.index) return;
    const destination = this.entries[index];
    const event = new Event("navigate", { cancelable: this.cancelable });
    Object.assign(event, {
      navigationType: "traverse",
      destination: { key: destination.key, url: destination.url, sameDocument: true },
    });
    this.dispatchEvent(event);
    if (event.defaultPrevented) {
      this.cancelled += 1;
      return;
    }
    this.index = index;
    this.replace(null, "", this.entries[index].url);
    this.dispatchEvent(new Event("currententrychange"));
    void Promise.resolve().then(() => window.dispatchEvent(new PopStateEvent("popstate", { state: null })));
  }

  private entry(url: string): FakeEntry {
    this.next += 1;
    return { key: `entry-${this.next}`, url: this.resolve(url) };
  }

  private resolve(url: string | URL): string {
    return new URL(url, window.location.href).href;
  }
}
