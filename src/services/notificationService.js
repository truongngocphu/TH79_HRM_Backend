import { Employees, EmployeeContracts, EmployeeChangeRequests } from '../models/raw.js';
import { enrichEmployees } from './employeeService.js';
import { getDigitalDocumentCoverage, getRequiredDocumentTypes } from './documentCoverageService.js';

export async function notificationFeed(limit = 30) {
  const today = new Date();
  const in10 = new Date(today); in10.setDate(in10.getDate()+10);
  const in30 = new Date(today); in30.setDate(in30.getDate()+30);
  const employees = await Employees.find({ deleted_at: null, employment_status: { $in: ['probation','active'] } }).lean();
  const enriched = await enrichEmployees(employees);
  const items = [];
  for (const e of enriched) {
    if (e.probation_end_date) {
      const d = new Date(e.probation_end_date);
      if (d <= in10) items.push({ type:'probation', severity:d < today?'danger':'warning', employee_id:e.id, title:`${e.full_name} sắp hết thử việc`, detail:`Hạn: ${d.toLocaleDateString('vi-VN')}`, href:`/employees/${e.id}` });
    }
  }
  const contracts = await EmployeeContracts.find({ status: { $in: ['active','signed'] }, end_date: { $ne: null } }).lean();
  for (const c of contracts) {
    const d = new Date(c.end_date);
    if (d <= in30) {
      const e = enriched.find(x => Number(x.id) === Number(c.employee_id));
      items.push({ type:'contract', severity:d < today?'danger':'warning', employee_id:c.employee_id, title:`Hợp đồng ${e?.full_name || '#'+c.employee_id} sắp hết hạn`, detail:`Hạn: ${d.toLocaleDateString('vi-VN')}`, href:`/employees/${c.employee_id}` });
    }
  }
  const required = await getRequiredDocumentTypes();
  if (required.length) {
    const coverage = await getDigitalDocumentCoverage(employees, required);
    for (const e of enriched) {
      const present = coverage.presentByEmployee.get(String(Number(e.id)))?.size || 0;
      const count = Math.max(0, required.length - present);
      if (count) items.push({ type:'document', severity:count>=3?'warning':'info', employee_id:e.id, title:`${e.full_name} thiếu ${count} hồ sơ số bắt buộc`, detail:e.employee_code, href:`/employees/${e.id}` });
    }
  }
  const pending = await EmployeeChangeRequests.countDocuments({ status:'pending' });
  if (pending) items.unshift({ type:'approval', severity:'info', title:`${pending} yêu cầu thay đổi thông tin chờ duyệt`, detail:'Employee Self-Service', href:'/self-service/requests' });
  const rank = {danger:0, warning:1, info:2};
  return items.sort((a,b)=>(rank[a.severity]??3)-(rank[b.severity]??3)).slice(0, limit);
}
