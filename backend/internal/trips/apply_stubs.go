package trips

import "github.com/janvillarosa/gracie-app/backend/internal/models"

func todoCreate(*models.Trip, models.Op, int64, Ctx, *models.OpResult) bool    { return false }
func todoUpdate(*models.Trip, models.Op, int64, Ctx, *models.OpResult) bool    { return false }
func todoDelete(*models.Trip, models.Op, Ctx, *models.OpResult) bool           { return false }
func bookingCreate(*models.Trip, models.Op, int64, Ctx, *models.OpResult) bool { return false }
func bookingUpdate(*models.Trip, models.Op, int64, Ctx, *models.OpResult) bool { return false }
func bookingDelete(*models.Trip, models.Op, Ctx, *models.OpResult) bool        { return false }
