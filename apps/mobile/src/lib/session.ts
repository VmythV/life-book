import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

const TOKEN_KEY = 'life-book.session-token';

export type SessionState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; token: string };

let state: SessionState = { status: 'loading' };
const listeners = new Set<() => void>();

function setState(next: SessionState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

/** 会话令牌保存在系统安全存储（iOS Keychain / Android Keystore）中。 */
export const session = {
  getToken(): string | null {
    return state.status === 'signedIn' ? state.token : null;
  },
  async load(): Promise<void> {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    setState(token === null ? { status: 'signedOut' } : { status: 'signedIn', token });
  },
  async signIn(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setState({ status: 'signedIn', token });
  },
  async signOut(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setState({ status: 'signedOut' });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): SessionState {
    return state;
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
