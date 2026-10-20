import { isApiError } from '@life-book/api-client';
import { type CreatableRecordType, creatableRecordTypes } from '@life-book/core';
import { type QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';

import { queryClient } from './api';
import { meQuery } from './queries';
import { AppLayout } from './routes/app-layout';
import { BookPage, validateBookSearch } from './routes/book';
import { CalendarPage, validateCalendarSearch } from './routes/calendar';
import { HomePage } from './routes/home';
import { LoginPage } from './routes/login';
import { NotFoundPage } from './routes/not-found';
import { EditRecordPage, NewRecordPage } from './routes/record-edit';
import { RouteError } from './routes/route-error';
import { SettingsPage } from './routes/settings';
import { TemplatesPage, validateTemplatesSearch } from './routes/templates';
import { TodayPage } from './routes/today';

interface RouterContext {
  queryClient: QueryClient;
}

/** 只允许站内路径，防止登录后被带到外部网站。 */
function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : undefined;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RouteError,
  notFoundComponent: NotFoundPage,
});

const authSearch = (search: Record<string, unknown>): { redirect?: string } => {
  const target = safeRedirect(search.redirect);
  return target === undefined ? {} : { redirect: target };
};

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: authSearch,
  component: LoginPage,
});

/** 需要登录的页面都挂在这个布局下。 */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery);
    } catch (error) {
      if (isApiError(error, 'UNAUTHENTICATED')) {
        throw redirect({ to: '/login', search: { redirect: location.href } });
      }
      throw error;
    }
  },
  component: AppLayout,
});

const todayRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: TodayPage,
});

const calendarRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/calendar',
  validateSearch: validateCalendarSearch,
  component: CalendarPage,
});

const bookRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/book',
  validateSearch: validateBookSearch,
  component: BookPage,
});

const newRecordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/book/new',
  validateSearch: (search: Record<string, unknown>): { type: CreatableRecordType } => ({
    type: (creatableRecordTypes as readonly unknown[]).includes(search.type)
      ? (search.type as CreatableRecordType)
      : 'recurring',
  }),
  component: NewRecordPage,
});

const editRecordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/book/$id/edit',
  component: EditRecordPage,
});

const homeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/home',
  component: HomePage,
});

const templatesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/templates',
  validateSearch: validateTemplatesSearch,
  component: TemplatesPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/settings',
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    todayRoute,
    calendarRoute,
    bookRoute,
    newRecordRoute,
    editRecordRoute,
    homeRoute,
    templatesRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
