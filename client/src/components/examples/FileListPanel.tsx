import FileListPanel from '../FileListPanel';

export default function FileListPanelExample() {
  const mockFiles = [
    { id: '1', name: 'Example1.inp', path: 'C:\\Projects\\SWMM\\Example1.inp' },
    { id: '2', name: 'Simulation_Model_v2.inp', path: 'C:\\Users\\Desktop\\Simulation_Model_v2.inp' },
    { id: '3', name: 'drainage_network.inp', path: 'C:\\Data\\Models\\drainage_network.inp' },
  ];

  const handleRemoveFile = (id: string) => {
    console.log('Remove file:', id);
  };

  const handleClearAll = () => {
    console.log('Clear all files');
  };

  return (
    <FileListPanel
      files={mockFiles}
      onRemoveFile={handleRemoveFile}
      onClearAll={handleClearAll}
    />
  );
}
