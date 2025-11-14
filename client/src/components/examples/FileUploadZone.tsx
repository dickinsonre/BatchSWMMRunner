import FileUploadZone from '../FileUploadZone';

export default function FileUploadZoneExample() {
  const handleFilesSelected = (files: FileList) => {
    console.log('Files selected:', files.length);
  };

  return <FileUploadZone onFilesSelected={handleFilesSelected} selectedCount={3} />;
}
