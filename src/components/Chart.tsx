'use client';
import dynamic from 'next/dynamic';
import type { CSSProperties } from 'react';
const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

export default function Chart({ option, style }: { option: any; style?: CSSProperties }) {
  return <ReactECharts option={option} style={style ?? { height: 320 }} />;
}
