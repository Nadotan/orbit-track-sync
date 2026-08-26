import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";

import {
  useEffect,
  useState,
} from "react";

import type {
  Session,
} from "@supabase/supabase-js";

import {
  Loader2,
} from "lucide-react";

import {
  supabase,
} from "@/integrations/supabase/client";

import {
  AppStoreProvider,
  useStore,
} from "@/lib/store";

import {
  SidebarProvider,
} from "@/components/ui/sidebar";

import {
  AppSidebar,
} from "@/components/app-sidebar";

import {
  AppHeader,
} from "@/components/app-header";

import {
  BottomNav,
} from "@/components/bottom-nav";

import {
  ActivePollButton,
} from "@/components/active-poll-button";

export const Route =
  createFileRoute(
    "/_authenticated",
  )({
    component:
      AuthenticatedLayout,
  });

function FullScreenLoader() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function AuthenticatedLayout() {
  const [
    session,
    setSession,
  ] =
    useState<
      | Session
      | null
      | undefined
    >(
      undefined,
    );

  const navigate =
    useNavigate();

  useEffect(
    () => {
      let active =
        true;

      supabase.auth
        .getSession()
        .then(
          ({
            data,
          }) => {
            if (
              active
            ) {
              setSession(
                data.session,
              );
            }
          },
        );

      const {
        data:
          listener,
      } =
        supabase.auth
          .onAuthStateChange(
            (
              _event,
              nextSession,
            ) => {
              setSession(
                nextSession,
              );
            },
          );

      return () => {
        active =
          false;

        listener.subscription
          .unsubscribe();
      };
    },
    [],
  );

  useEffect(
    () => {
      if (
        session ===
        null
      ) {
        navigate({
          to:
            "/sign-in",

          replace:
            true,
        });
      }
    },
    [
      session,
      navigate,
    ],
  );

  if (
    session ===
      undefined ||
    session ===
      null
  ) {
    return (
      <FullScreenLoader />
    );
  }

  return (
    <AppStoreProvider
      session={
        session
      }
    >
      <AuthenticatedShell />
    </AppStoreProvider>
  );
}

function AuthenticatedShell() {
  const {
    loading,
    needsOnboarding,
  } =
    useStore();

  const pathname =
    useRouterState({
      select:
        (
          r,
        ) =>
          r.location
            .pathname,
    });

  const navigate =
    useNavigate();

  useEffect(
    () => {
      if (
        loading
      ) {
        return;
      }

      if (
        needsOnboarding &&
        pathname !==
          "/onboarding"
      ) {
        navigate({
          to:
            "/onboarding",

          replace:
            true,
        });
      } else if (
        !needsOnboarding &&
        pathname ===
          "/onboarding"
      ) {
        navigate({
          to:
            "/",

          replace:
            true,
        });
      }
    },
    [
      loading,
      needsOnboarding,
      pathname,
      navigate,
    ],
  );

  if (
    loading
  ) {
    return (
      <FullScreenLoader />
    );
  }

  if (
    pathname ===
    "/onboarding"
  ) {
    return (
      <main className="min-h-screen">
        <Outlet />
      </main>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader />

          <main className="flex-1 px-4 pb-28 pt-6 sm:px-6 md:pb-10 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>

      <BottomNav />

      <ActivePollButton />
    </SidebarProvider>
  );
}