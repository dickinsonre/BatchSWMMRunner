import ProgressSection from '../ProgressSection';

export default function ProgressSectionExample() {
  return (
    <ProgressSection
      current={3}
      total={10}
      currentFileName="drainage_network.inp"
    />
  );
}
