import ResultsDisplay from '../ResultsDisplay';

export default function ResultsDisplayExample() {
  const mockResults = [
    {
      id: '1',
      fileName: 'Example1.inp',
      filePath: 'C:\\Projects\\SWMM\\Example1.inp',
      status: 'success' as const,
    },
    {
      id: '2',
      fileName: 'Simulation_Model_v2.inp',
      filePath: 'C:\\Users\\Desktop\\Simulation_Model_v2.inp',
      status: 'success' as const,
    },
    {
      id: '3',
      fileName: 'drainage_network.inp',
      filePath: 'C:\\Data\\Models\\drainage_network.inp',
      status: 'failed' as const,
      error: 'Error 110: cannot open rainfall data file',
    },
    {
      id: '4',
      fileName: 'urban_catchment.inp',
      filePath: 'C:\\Data\\Models\\urban_catchment.inp',
      status: 'success' as const,
    },
  ];

  return <ResultsDisplay results={mockResults} />;
}
