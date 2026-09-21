"use client";

import { useEffect, useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { Toaster } from 'sonner';
import { routes } from './routes';
import { installInputGuard } from './app/input-guard';

export default function App() {
  const router = useMemo(() => createBrowserRouter(routes), []);
  useEffect(() => installInputGuard(), []);

  return (
    <>
      <RouterProvider router={router} />
      <Toaster position="top-center" richColors />
    </>
  );
}
