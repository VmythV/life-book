import type { ScaffoldStatusViewModel } from '../application/read-scaffold-status';
import { ScaffoldScreen } from '../presentation/scaffold-screen';

interface ScaffoldNavigationProps {
  readonly viewModel: ScaffoldStatusViewModel;
}

export function ScaffoldNavigation({ viewModel }: ScaffoldNavigationProps) {
  return <ScaffoldScreen viewModel={viewModel} />;
}
