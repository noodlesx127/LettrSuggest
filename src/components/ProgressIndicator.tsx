/**
 * Progress Indicator Component
 * 
 * Shows detailed progress for multi-stage operations like recommendation generation.
 * Displays percentage, stage labels, and current operation details.
 */

type ProgressStage = {
  key: string;
  label: string;
  description: string;
};

type ProgressIndicatorProps = {
  current: number;
  total: number;
  stage: string;
  stages: ProgressStage[];
  details?: string; // Additional details about current operation
  className?: string;
};

export default function ProgressIndicator({ 
  current, 
  total, 
  stage, 
  stages,
  details,
  className = '' 
}: ProgressIndicatorProps) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  const currentStageIndex = stages.findIndex(s => s.key === stage);
  const currentStageInfo = stages[currentStageIndex];
  
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-700 dark:text-gray-300">
            {currentStageInfo?.label || 'Processing...'}
          </span>
          <span className="text-gray-500 dark:text-gray-400">
            {current}/{total} stages ({percentage}%)
          </span>
        </div>
        
        <div className="relative w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div 
            className="absolute top-0 left-0 h-full bg-blue-600 dark:bg-blue-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${percentage}%` }}
          >
            {/* Animated pulse on the progress bar */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
          </div>
        </div>
      </div>
      
      {/* Stage dots */}
      <div className="flex items-center justify-between">
        {stages.map((s, idx) => {
          const isCompleted = idx < currentStageIndex;
          const isCurrent = idx === currentStageIndex;
          const isPending = idx > currentStageIndex;
          
          return (
            <div key={s.key} className="flex items-center flex-1">
              {/* Stage circle */}
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300 ${
                    isCompleted
                      ? 'bg-green-500 dark:bg-green-600 text-white'
                      : isCurrent
                      ? 'bg-blue-600 dark:bg-blue-500 text-white ring-4 ring-blue-200 dark:ring-blue-900 animate-pulse'
                      : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <span className={`mt-1.5 text-[10px] font-medium text-center ${
                  isCurrent 
                    ? 'text-blue-600 dark:text-blue-400' 
                    : isCompleted 
                    ? 'text-green-600 dark:text-green-400' 
                    : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {s.label}
                </span>
              </div>
              
              {/* Connector line */}
              {idx < stages.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 rounded transition-colors duration-300 ${
                  isCompleted ? 'bg-green-500 dark:bg-green-600' : 'bg-gray-200 dark:bg-gray-700'
                }`} />
              )}
            </div>
          );
        })}
      </div>
      
      {/* Current stage description and details */}
      <div className="text-center space-y-1">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {currentStageInfo?.description || ''}
        </p>
        {details && (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic">
            {details}
          </p>
        )}
      </div>
    </div>
  );
}
