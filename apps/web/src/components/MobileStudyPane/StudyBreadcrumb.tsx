export interface BreadcrumbItem {
  label: string;
  onClick?: () => void;
}

interface StudyBreadcrumbProps {
  crumbs: BreadcrumbItem[];
}

export function StudyBreadcrumb({ crumbs }: StudyBreadcrumbProps) {
  return (
    <div class="study-breadcrumb">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={i}>
            {i > 0 && <span class="study-breadcrumb__separator"><i class="fa-solid fa-chevron-right" /></span>}
            {isLast || !crumb.onClick ? (
              <span class="study-breadcrumb__current">{crumb.label}</span>
            ) : (
              <button class="study-breadcrumb__link" onClick={crumb.onClick}>{crumb.label}</button>
            )}
          </span>
        );
      })}
    </div>
  );
}
