declare module 'react-window' {
  import * as React from 'react';
  export interface GridChildComponentProps {
    columnIndex: number;
    rowIndex: number;
    style: React.CSSProperties;
    isScrolling?: boolean;
    data?: any;
  }
  export interface FixedSizeGridProps {
    columnCount: number;
    columnWidth: number;
    height: number;
    rowCount: number;
    rowHeight: number;
    width: number;
    children: (props: GridChildComponentProps) => React.ReactNode;
  }
  export class FixedSizeGrid extends React.Component<FixedSizeGridProps> {}
  export { FixedSizeGrid as Grid, FixedSizeGrid as FixedSizeGridComponent };
}
