'use client';

import dynamic from 'next/dynamic';
import '@/modules/radar-precatorios/radar.css';

const RadarPrecatorios = dynamic(() => import('@/modules/radar-precatorios'), {
  ssr: false,
  loading: () => <p style={{ padding: 24 }}>Carregando o Radar de Precatórios…</p>,
});

export default function PaginaRadarPrecatorios() {
  return <RadarPrecatorios incorporado />;
}
