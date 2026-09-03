import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDb() {
  // IMPORTANT for the MySQL -> MongoDB migration:
  // most collections use a flexible raw schema. strictQuery=true strips
  // filters such as employee_id, branch_id and the legacy numeric id because
  // those fields are not declared on the minimal schema. That caused queries
  // like EmployeeDocuments.find({ employee_id: 1 }) to return ALL documents.
  mongoose.set('strictQuery', false);

  await mongoose.connect(env.mongoUri);
  console.log(`MongoDB connected: ${mongoose.connection.name}`);
}
