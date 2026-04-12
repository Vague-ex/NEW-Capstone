"use client";

import { useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './routes';

export default function App() {
  const router = useMemo(() => createBrowserRouter(routes), []);

  return <RouterProvider router={router} />;
}
