"use client";

import { useEffect, useMemo } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { routes } from './routes';
import { installEmojiGuard } from './app/no-emoji';

export default function App() {
  const router = useMemo(() => createBrowserRouter(routes), []);
  useEffect(() => installEmojiGuard(), []);

  return <RouterProvider router={router} />;
}
