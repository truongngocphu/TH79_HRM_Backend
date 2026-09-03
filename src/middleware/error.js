export function notFound(req, res) { res.status(404).json({ message: 'Không tìm thấy API.' }); }

export function errorHandler(err, req, res, next) {
  console.error(err);

  if (err?.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Tệp tải lên vượt quá dung lượng cho phép.'
      : `Không thể nhận tệp tải lên (${err.code || 'MulterError'}).`;
    return res.status(status).json({ message, detail: process.env.NODE_ENV === 'development' ? err.message : undefined });
  }

  const status = Number(err?.status || err?.statusCode || 500);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  const message = safeStatus === 500 ? 'Có lỗi hệ thống xảy ra.' : (err?.message || 'Yêu cầu không thể xử lý.');
  return res.status(safeStatus).json({
    message,
    detail: process.env.NODE_ENV === 'development' ? err?.message : undefined
  });
}
