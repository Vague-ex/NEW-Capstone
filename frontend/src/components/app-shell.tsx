"use client";

import dynamic from 'next/dynamic';

const App = dynamic(() => import('@/App'), { ssr: false });

export function AppShell() {
    return <App />;
}
