import { useRows, opts } from './lib.jsx'

export const useMeshes = () => useRows('grade_meshes', { select: '*', order: 'mesh', asc: true })

// Two linked form fields: grade, then the mesh sizes of that grade.
export function gradeMeshFields(grades, meshes, { label = 'Grade', gradeRequired = true, meshRequired = true } = {}) {
  const forGrade = (v) => meshes.filter((m) => m.grade_id === v.grade_id && (m.active || m.id === v.mesh_id))
  return [
    { name: 'grade_id', label, type: 'select', required: gradeRequired, options: opts(grades), onPick: () => ({ mesh_id: '' }) },
    {
      name: 'mesh_id',
      label: 'Mesh size',
      type: 'select',
      required: (v) => meshRequired && forGrade(v).length > 0,
      optionsFor: (v) => opts(forGrade(v), 'mesh'),
      showIf: (v) => !!v.grade_id && meshes.some((m) => m.grade_id === v.grade_id),
    },
  ]
}
